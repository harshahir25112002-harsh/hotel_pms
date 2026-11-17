import frappe
from frappe import _
from frappe.model.document import Document


class HotelRoomType(Document):
    def validate(self):
        if (self.max_adults or 0) < 1:
            frappe.throw(_("Max Adults must be at least 1"))
        if (self.base_rate or 0) < 0:
            frappe.throw(_("Base Rate cannot be negative"))
