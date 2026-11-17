import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, today, nowdate

class GuestFolio(Document):
    def validate(self):
        self.set_defaults()
        self.calculate_totals()
        self.fetch_payments()

    def set_defaults(self):
        if not self.company:
            self.company = frappe.db.get_single_value("Hotel Settings", "company") or frappe.defaults.get_user_default("Company")
        if not self.posting_date:
            self.posting_date = today()

    def calculate_totals(self):
        total_charges = 0.0
        total_tax = 0.0

        for row in self.get("charges", []):
            qty = flt(row.qty) or 1.0
            rate = flt(row.rate)
            row.amount = flt(qty * rate, 2)

            # Auto GST determination if not manually overridden
            if not row.tax_rate and row.charge_type == "Room Rent":
                if rate > 7500:
                    row.tax_rate = 18.0
                elif rate > 0:
                    row.tax_rate = 12.0
                else:
                    row.tax_rate = 0.0

            tax_pct = flt(row.tax_rate)
            row.tax_amount = flt((row.amount * tax_pct) / 100.0, 2)
            row.total_amount = flt(row.amount + row.tax_amount, 2)

            total_charges += row.amount
            total_tax += row.tax_amount

        self.total_charges = flt(total_charges, 2)
        self.total_tax = flt(total_tax, 2)
        self.grand_total = flt(total_charges + total_tax, 2)

    def fetch_payments(self):
        advance = 0.0
        payments = 0.0

        if self.reservation:
            adv_entries = frappe.db.sql("""
                SELECT sum(paid_amount) FROM `tabPayment Entry`
                WHERE docstatus = 1 AND hotel_reservation = %s AND payment_type = 'Receive'
            """, (self.reservation,))
            if adv_entries and adv_entries[0][0]:
                advance += flt(adv_entries[0][0])

        if self.stay:
            stay_entries = frappe.db.sql("""
                SELECT sum(paid_amount) FROM `tabPayment Entry`
                WHERE docstatus = 1 AND hotel_stay = %s AND payment_type = 'Receive'
            """, (self.stay,))
            if stay_entries and stay_entries[0][0]:
                payments += flt(stay_entries[0][0])

        self.advance_paid = flt(advance, 2)
        self.payments_received = flt(payments, 2)
        self.total_paid = flt(self.advance_paid + self.payments_received, 2)
        self.outstanding_balance = flt(self.grand_total - self.total_paid, 2)

    @frappe.whitelist()
    def add_charge(self, charge_type, rate, qty=1, item=None, description=None, room=None):
        """Append a new charge entry and recalculate folio"""
        self.append("charges", {
            "posting_date": today(),
            "charge_type": charge_type,
            "item": item,
            "description": description or f"{charge_type} charge",
            "room": room,
            "qty": flt(qty),
            "rate": flt(rate)
        })
        self.save()
        return {"status": "success", "outstanding_balance": self.outstanding_balance}

    @frappe.whitelist()
    def create_sales_invoice(self):
        """Generate ERPNext Sales Invoice and post to General Ledger"""
        if self.sales_invoice:
            frappe.throw(_("Sales Invoice {0} already exists for this Folio").format(self.sales_invoice))

        if not self.charges:
            frappe.throw(_("Cannot generate invoice for a folio with no charges."))

        customer = self.corporate_customer if (self.billing_party_type == "Company" and self.corporate_customer) else self.guest
        settings = frappe.get_single("Hotel Settings")

        inv = frappe.new_doc("Sales Invoice")
        inv.customer = customer
        inv.company = self.company
        inv.posting_date = today()
        inv.due_date = today()
        inv.hotel_stay = self.stay
        inv.hotel_folio = self.name

        if settings.default_cost_center:
            inv.cost_center = settings.default_cost_center

        for charge in self.charges:
            item_code = charge.item or settings.room_rent_item
            if not item_code:
                item_code = frappe.db.get_value("Item", {"is_sales_item": 1}, "name")

            inv.append("items", {
                "item_code": item_code,
                "description": charge.description or charge.charge_type,
                "qty": charge.qty or 1,
                "rate": charge.rate,
                "income_account": settings.default_income_account
            })

        if settings.sales_taxes_template:
            inv.taxes_and_charges = settings.sales_taxes_template
            inv.set_taxes()

        inv.set_missing_values()
        inv.flags.ignore_mandatory = True
        inv.insert(ignore_permissions=True)
        inv.submit()

        self.sales_invoice = inv.name
        self.status = "Settled"
        self.save(ignore_permissions=True)

        return inv.name

@frappe.whitelist()
def add_charge(folio=None, charge_type=None, rate=0, qty=1, item=None, description=None, room=None):
    if not folio and frappe.form_dict.get("name"):
        folio = frappe.form_dict.get("name")
    if not folio:
        frappe.throw(_("Folio ID is required."))
    return frappe.get_doc("Guest Folio", folio).add_charge(
        charge_type=charge_type, rate=rate, qty=qty, item=item, description=description, room=room
    )

@frappe.whitelist()
def create_sales_invoice(folio=None):
    if not folio and frappe.form_dict.get("name"):
        folio = frappe.form_dict.get("name")
    if not folio:
        frappe.throw(_("Folio ID is required."))
    return frappe.get_doc("Guest Folio", folio).create_sales_invoice()
