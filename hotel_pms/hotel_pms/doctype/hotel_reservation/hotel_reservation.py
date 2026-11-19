import re
import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import date_diff, flt, getdate, today

class HotelReservation(Document):
    def validate(self):
        self.validate_dates()
        self.validate_guest_contact()
        self.validate_tariff()
        self.calculate_financials()
        self.check_room_availability()

    def validate_dates(self):
        if not self.arrival_date or not self.departure_date:
            frappe.throw(_("Arrival and Departure dates are mandatory."))

        if self.is_new() and getdate(self.arrival_date) < getdate(today()):
            frappe.throw(_("Arrival Date cannot be in the past."))

        if getdate(self.departure_date) <= getdate(self.arrival_date):
            frappe.throw(_("Departure date must be after Arrival date."))

        self.nights = max(1, date_diff(self.departure_date, self.arrival_date))

    def validate_guest_contact(self):
        if self.contact_phone:
            clean = re.sub(r"\D", "", str(self.contact_phone).strip())
            if len(clean) == 12 and clean.startswith("91"):
                clean = clean[2:]
            elif len(clean) == 11 and clean.startswith("0"):
                clean = clean[1:]

            if len(clean) != 10:
                frappe.throw(_("Invalid Contact Phone '{0}'. Mobile phone number must be exactly 10 digits (e.g. 9876543210).").format(self.contact_phone))
            self.contact_phone = clean

        if self.contact_email:
            from frappe.utils import validate_email_address
            try:
                validate_email_address(self.contact_email.strip(), throw=True)
            except Exception:
                frappe.throw(_("Invalid Contact Email '{0}'.").format(self.contact_email))

    def validate_tariff(self):
        if flt(self.room_rate) <= 0:
            frappe.throw(_("Daily Room Rate must be greater than zero."))
        if flt(self.advance_paid) < 0:
            frappe.throw(_("Advance Paid cannot be negative."))

    def calculate_financials(self):
        self.estimated_total = flt(self.nights * flt(self.room_rate), 2)

        if not self.is_new():
            advance = frappe.db.sql("""
                SELECT sum(paid_amount) FROM `tabPayment Entry`
                WHERE docstatus = 1 AND hotel_reservation = %s AND payment_type = 'Receive'
            """, (self.name,))
            self.advance_paid = flt(advance[0][0]) if advance and advance[0][0] else 0.0

            if self.advance_paid >= self.estimated_total and self.estimated_total > 0:
                self.payment_status = "Fully Paid"
            elif self.advance_paid > 0:
                self.payment_status = "Partially Paid"
            else:
                self.payment_status = "Unpaid"

    def check_room_availability(self):
        if self.assigned_room and self.status not in ["Cancelled", "Completed"]:
            conflict = frappe.db.sql("""
                SELECT name FROM `tabHotel Reservation`
                WHERE assigned_room = %s 
                  AND name != %s
                  AND docstatus < 2
                  AND status in ('Confirmed', 'Checked In')
                  AND (
                      (arrival_date <= %s AND departure_date > %s)
                      OR (arrival_date < %s AND departure_date >= %s)
                      OR (arrival_date >= %s AND departure_date <= %s)
                  )
            """, (self.assigned_room, self.name or "", self.arrival_date, self.arrival_date,
                  self.departure_date, self.departure_date, self.arrival_date, self.departure_date))

            if conflict:
                frappe.msgprint(_("Warning: Room {0} has an overlapping reservation {1}.").format(
                    self.assigned_room, conflict[0][0]
                ), indicator="orange")

    @frappe.whitelist()
    def create_check_in(self, room=None, reservation=None, **kwargs):
        """Perform Check-In: creates Hotel Stay & Guest Folio, updates Room status"""
        if self.status == "Checked In":
            frappe.throw(_("This reservation is already Checked In."))

        room_to_assign = room or self.assigned_room
        if not room_to_assign:
            frappe.throw(_("Please assign a room before checking in."))

        room_data = frappe.db.get_value("Hotel Room", room_to_assign, ["status", "room_type"], as_dict=True)
        if not room_data:
            frappe.throw(_("Room {0} not found.").format(room_to_assign))
        if room_data.status == "Occupied":
            frappe.throw(_("Room {0} is currently occupied.").format(room_to_assign))

        # 1. Create Hotel Stay (which locks room as Occupied in after_insert)
        stay = frappe.new_doc("Hotel Stay")
        stay.reservation = self.name
        stay.guest = self.guest
        stay.room = room_to_assign
        stay.room_type = self.room_type or room_data.room_type
        stay.company = self.company
        stay.checkin_date = today()
        stay.expected_checkout_date = self.departure_date
        stay.room_rate = self.room_rate
        stay.adults = self.adults
        stay.children = self.children
        stay.status = "Active"
        stay.insert(ignore_permissions=True)

        # 2. Update Reservation status using db_set so it works regardless of docstatus
        self.db_set("status", "Checked In")
        self.db_set("assigned_room", room_to_assign)
        self.db_set("stay", stay.name)

        return stay.name

@frappe.whitelist()
def create_check_in(reservation=None, room=None, **kwargs):
    """Module-level wrapper so it can be called both ways"""
    if not reservation and frappe.form_dict.get("name"):
        reservation = frappe.form_dict.get("name")
    if not reservation and frappe.form_dict.get("doc"):
        import json
        try:
            d = json.loads(frappe.form_dict.get("doc"))
            reservation = d.get("name")
        except Exception:
            pass

    if not reservation:
        frappe.throw(_("Reservation ID is required for Check-In."))

    res_doc = frappe.get_doc("Hotel Reservation", reservation)
    return res_doc.create_check_in(room=room, **kwargs)
