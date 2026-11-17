import frappe
from frappe import _
from frappe.model.document import Document


class HotelRatePlan(Document):
    def validate(self):
        if self.from_date and self.to_date and self.from_date > self.to_date:
            frappe.throw(_("From Date cannot be after To Date"))
        if (self.rate or 0) < 0:
            frappe.throw(_("Rate cannot be negative"))
