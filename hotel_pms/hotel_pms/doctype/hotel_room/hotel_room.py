import frappe
from frappe import _
from frappe.model.document import Document


class HotelRoom(Document):
    def validate(self):
        if not self.room_number or not str(self.room_number).strip():
            frappe.throw(_("Room Number is mandatory."))
        self.room_number = str(self.room_number).strip()

        # Check duplicate room_number
        duplicate = frappe.db.get_value("Hotel Room", {
            "room_number": self.room_number,
            "name": ["!=", self.name or ""]
        }, "name")
        if duplicate:
            frappe.throw(_("Room Number '{0}' already exists in Room {1}.").format(self.room_number, duplicate))
