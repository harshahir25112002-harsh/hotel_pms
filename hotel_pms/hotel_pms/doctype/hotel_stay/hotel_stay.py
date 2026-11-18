import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, nowdate, today, date_diff, now_datetime

class HotelStay(Document):
    def after_insert(self):
        self.lock_room_and_create_folio()

    def lock_room_and_create_folio(self):
        # 1. Mark Room as Occupied
        if self.room:
            frappe.db.set_value("Hotel Room", self.room, "status", "Occupied")

        # 2. Create Guest Folio if none exists
        if not self.folio:
            folio = frappe.new_doc("Guest Folio")
            folio.guest = self.guest
            folio.stay = self.name
            folio.reservation = self.reservation
            folio.company = self.company
            folio.posting_date = today()
            
            settings = frappe.get_single("Hotel Settings")
            rent_item = settings.room_rent_item
            if not rent_item:
                rent_item = frappe.db.get_value("Item", {"is_sales_item": 1}, "name")

            folio.append("charges", {
                "posting_date": today(),
                "charge_type": "Room Rent",
                "item": rent_item,
                "description": f"Room {self.room} Rent - {today()}",
                "room": self.room,
                "qty": 1,
                "rate": flt(self.room_rate)
            })
            folio.flags.ignore_mandatory = True
            folio.insert(ignore_permissions=True)
            self.db_set("folio", folio.name)

    @frappe.whitelist()
    def process_checkout(self, **kwargs):
        """Checkout workflow: check folio balance, generate invoice, update room to Vacant Dirty, create Housekeeping Task"""
        if self.status == "Checked Out":
            frappe.throw(_("This stay is already checked out."))

        if not self.folio:
            frappe.throw(_("No Folio found for this stay."))

        folio_doc = frappe.get_doc("Guest Folio", self.folio)
        folio_doc.calculate_totals()
        folio_doc.fetch_payments()

        # If balance remains, prompt user to settle
        if folio_doc.outstanding_balance > 0:
            frappe.throw(_("Folio {0} has an outstanding balance of {1}. Please collect payment before checking out.").format(
                folio_doc.name, folio_doc.outstanding_balance
            ))

        # Generate ERPNext Sales Invoice if not exists
        if not folio_doc.sales_invoice and folio_doc.charges:
            inv_name = folio_doc.create_sales_invoice()
            self.sales_invoice = inv_name

        # Mark Room as Vacant Dirty
        if self.room:
            frappe.db.set_value("Hotel Room", self.room, "status", "Vacant Dirty")

            # Auto-create Housekeeping Task for cleaning
            task = frappe.new_doc("Housekeeping Task")
            task.room = self.room
            task.task_type = "Checkout Cleaning"
            task.priority = "High"
            task.status = "Pending"
            task.assigned_date = today()
            task.notes = f"Generated automatically upon checkout of Stay {self.name} (Guest: {self.guest_name})"
            task.insert(ignore_permissions=True)

        self.status = "Checked Out"
        self.actual_checkout_date = today()
        self.save(ignore_permissions=True)

        if self.reservation:
            frappe.db.set_value("Hotel Reservation", self.reservation, "status", "Completed")

        return {"status": "success", "invoice": self.sales_invoice}

    @frappe.whitelist()
    def move_room(self, new_room, reason=None, **kwargs):
        """Move guest to a new room mid-stay"""
        if self.status != "Active":
            frappe.throw(_("Room movement is only allowed for Active stays."))

        if new_room == self.room:
            frappe.throw(_("New room cannot be the same as the current room."))

        new_room_doc = frappe.get_doc("Hotel Room", new_room)
        if new_room_doc.status != "Vacant Clean":
            frappe.throw(_("New room {0} is currently '{1}'. Must be 'Vacant Clean' to move.").format(new_room, new_room_doc.status))

        old_room = self.room
        old_rate = self.room_rate

        new_room_type = new_room_doc.room_type
        new_rate = frappe.db.get_value("Hotel Room Type", new_room_type, "base_rate") or old_rate

        frappe.db.set_value("Hotel Room", old_room, "status", "Vacant Dirty")
        hk_task = frappe.new_doc("Housekeeping Task")
        hk_task.room = old_room
        hk_task.task_type = "Room Transfer Cleaning"
        hk_task.status = "Pending"
        hk_task.priority = "Medium"
        hk_task.assigned_date = today()
        hk_task.notes = f"Guest moved to Room {new_room}. Reason: {reason or 'Guest request'}"
        hk_task.insert(ignore_permissions=True)

        new_room_doc.status = "Occupied"
        new_room_doc.save(ignore_permissions=True)

        movement = frappe.new_doc("Hotel Room Movement")
        movement.stay = self.name
        movement.guest = self.guest
        movement.from_room = old_room
        movement.to_room = new_room
        movement.move_date = today()
        movement.reason = reason or "Room change request"
        movement.old_rate = old_rate
        movement.new_rate = new_rate
        movement.insert(ignore_permissions=True)

        timestamp = now_datetime().strftime("%Y-%m-%d %H:%M")
        log_entry = f"[{timestamp}] Moved from Room {old_room} (Rate: {old_rate}) to Room {new_room} (Rate: {new_rate}). Reason: {reason or 'N/A'}\n"
        self.movements_log = (self.movements_log or "") + log_entry
        self.room = new_room
        self.room_type = new_room_type
        self.room_rate = new_rate
        self.save(ignore_permissions=True)

        return {"status": "success", "movement": movement.name, "new_room": new_room}

@frappe.whitelist()
def process_checkout(stay=None, **kwargs):
    if not stay and frappe.form_dict.get("name"):
        stay = frappe.form_dict.get("name")
    if not stay:
        frappe.throw(_("Stay ID is required."))
    return frappe.get_doc("Hotel Stay", stay).process_checkout(**kwargs)

@frappe.whitelist()
def move_room(stay=None, new_room=None, reason=None, **kwargs):
    if not stay and frappe.form_dict.get("name"):
        stay = frappe.form_dict.get("name")
    if not stay:
        frappe.throw(_("Stay ID is required."))
    return frappe.get_doc("Hotel Stay", stay).move_room(new_room=new_room, reason=reason, **kwargs)
