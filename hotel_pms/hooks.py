app_name = "hotel_pms"
app_title = "Hotel PMS"
app_publisher = "Hotel PMS Team"
app_description = "Next-Gen Hotel Property Management System (PMS) for ERPNext / Frappe v16"
app_email = "admin@example.com"
app_license = "mit"

required_apps = ["erpnext"]

# Custom fields added on core doctypes (exported as fixtures)
fixtures = [
    {"dt": "Custom Field", "filters": [["module", "=", "Hotel PMS"]]},
]

# Automated Night Audit Scheduled Event
scheduler_events = {
    "cron": {
        "0 2 * * *": [
            "hotel_pms.hotel_pms.doctype.night_audit.night_audit.execute_daily_night_audit"
        ]
    }
}
