import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, now_datetime, today

class NightAudit(Document):
    def validate(self):
        if not self.audit_date:
            self.audit_date = today()

    @frappe.whitelist()
    def run_audit(self):
        """Execute Night Audit: post room rents, reconcile folios, compute ADR/RevPAR"""
        if self.status == "Completed":
            frappe.throw(_("Night Audit for {0} is already completed.").format(self.audit_date))

        logs = []
        logs.append(f"Starting Night Audit for Date: {self.audit_date}")

        # 1. Fetch all active stays
        active_stays = frappe.get_all("Hotel Stay", filters={"status": "Active"}, fields=["name", "guest", "room", "room_rate", "folio"])
        total_stays = len(active_stays)
        logs.append(f"Found {total_stays} active stays in-house.")

        posted_count = 0
        room_revenue = 0.0
        settings = frappe.get_single("Hotel Settings")
        rent_item = settings.room_rent_item
        if not rent_item:
            rent_item = frappe.db.get_value("Item", {"is_sales_item": 1}, "name")

        for stay in active_stays:
            if not stay.folio:
                continue

            # Check if room rent for this date is already posted on the folio
            existing = frappe.db.sql("""
                SELECT name FROM `tabHotel Folio Charge`
                WHERE parent = %s AND posting_date = %s AND charge_type = 'Room Rent'
            """, (stay.folio, self.audit_date))

            rate = flt(stay.room_rate)
            room_revenue += rate

            if not existing:
                folio_doc = frappe.get_doc("Guest Folio", stay.folio)
                folio_doc.append("charges", {
                    "posting_date": self.audit_date,
                    "charge_type": "Room Rent",
                    "item": rent_item,
                    "description": f"Room {stay.room} Night Tariff - {self.audit_date}",
                    "room": stay.room,
                    "qty": 1,
                    "rate": rate
                })
                folio_doc.save(ignore_permissions=True)
                posted_count += 1
                logs.append(f"Posted room rent {rate} to Folio {stay.folio} (Room {stay.room})")
            else:
                logs.append(f"Room rent already exists on Folio {stay.folio} for {self.audit_date}, skipping duplicate.")

        # 2. Compute Hotel Metrics
        total_rooms = frappe.db.count("Hotel Room", filters={"is_active": 1})
        occupied_rooms = total_stays

        occupancy_rate = flt((occupied_rooms / total_rooms) * 100, 2) if total_rooms > 0 else 0.0
        adr = flt(room_revenue / occupied_rooms, 2) if occupied_rooms > 0 else 0.0
        revpar = flt(room_revenue / total_rooms, 2) if total_rooms > 0 else 0.0

        # Calculate extra charges posted today
        extra_rev = frappe.db.sql("""
            SELECT sum(amount) FROM `tabHotel Folio Charge`
            WHERE posting_date = %s AND charge_type != 'Room Rent'
        """, (self.audit_date,))
        total_extra = flt(extra_rev[0][0]) if extra_rev and extra_rev[0][0] else 0.0

        self.total_rooms = total_rooms
        self.occupied_rooms = occupied_rooms
        self.occupancy_rate = occupancy_rate
        self.total_room_revenue = room_revenue
        self.total_extra_revenue = total_extra
        self.total_revenue = flt(room_revenue + total_extra, 2)
        self.adr = adr
        self.revpar = revpar
        self.audited_by = frappe.session.user
        self.execution_time = now_datetime()
        self.status = "Completed"

        logs.append(f"Audit completed: Occupancy {occupancy_rate}%, ADR {adr}, RevPAR {revpar}, Total Revenue: {self.total_revenue}")
        self.audit_log = "\n".join(logs)
        self.save(ignore_permissions=True)

        return {"status": "success", "occupancy": occupancy_rate, "total_revenue": self.total_revenue}

@frappe.whitelist()
def run_audit(name=None, **kwargs):
    if not name and frappe.form_dict.get("name"):
        name = frappe.form_dict.get("name")
    if not name and frappe.form_dict.get("doc"):
        doc = frappe.form_dict.get("doc")
        if isinstance(doc, str):
            import json
            doc = json.loads(doc)
        name = doc.get("name")
    if not name:
        frappe.throw(_("Night Audit ID is required."))
    return frappe.get_doc("Night Audit", name).run_audit()

def execute_daily_night_audit():
    """Hook scheduler function to run automatically at 02:00 AM"""
    today_date = today()
    existing = frappe.db.get_value("Night Audit", {"audit_date": today_date}, "name")
    if not existing:
        audit = frappe.new_doc("Night Audit")
        audit.audit_date = today_date
        audit.insert(ignore_permissions=True)
        audit.run_audit()

