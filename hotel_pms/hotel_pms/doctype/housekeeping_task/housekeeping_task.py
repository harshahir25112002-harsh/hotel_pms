import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import now_datetime

class HousekeepingTask(Document):
    def validate(self):
        if self.status in ["Completed", "Inspected"] and not self.completed_on:
            self.completed_on = now_datetime()

    def on_update(self):
        # When housekeeping is marked completed/inspected, set room to Vacant Clean
        if self.status in ["Completed", "Inspected"] and self.room:
            current_status = frappe.db.get_value("Hotel Room", self.room, "status")
            if current_status == "Vacant Dirty":
                frappe.db.set_value("Hotel Room", self.room, "status", "Vacant Clean")

    @frappe.whitelist()
    def mark_completed(self):
        """1-click mark as clean and update room status"""
        self.status = "Completed"
        self.completed_on = now_datetime()
        self.save()
        if self.room:
            frappe.db.set_value("Hotel Room", self.room, "status", "Vacant Clean")
        return {"status": "success", "room": self.room, "room_status": "Vacant Clean"}

