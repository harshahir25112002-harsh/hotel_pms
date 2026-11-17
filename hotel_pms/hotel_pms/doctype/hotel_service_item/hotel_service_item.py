import frappe
from frappe import _
from frappe.model.document import Document


class HotelServiceItem(Document):
    def validate(self):
        if self.is_stock_item and not self.warehouse:
            frappe.throw(_("Warehouse is required for stock items"))
        if (self.rate or 0) < 0:
            frappe.throw(_("Rate cannot be negative"))
