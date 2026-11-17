import frappe
from frappe import _
from frappe.utils import flt, getdate, today

@frappe.whitelist()
def get_dashboard_data(selected_date=None):
    date_val = selected_date or today()

    # 1. Room Metrics & Status Breakdown
    rooms = frappe.get_all("Hotel Room", 
        filters={"is_active": 1},
        fields=["name", "room_number", "floor", "room_type", "status", "notes"],
        order_by="floor asc, room_number asc"
    )

    total_rooms = len(rooms)
    vacant_clean = 0
    vacant_dirty = 0
    occupied = 0
    out_of_order = 0

    # Build room lookup map
    room_map = {}
    for r in rooms:
        status = r.status or "Vacant Clean"
        if status == "Vacant Clean":
            vacant_clean += 1
        elif status == "Vacant Dirty":
            vacant_dirty += 1
        elif status == "Occupied":
            occupied += 1
        elif status == "Out of Order":
            out_of_order += 1

        room_map[r.name] = {
            "room": r.name,
            "room_number": r.room_number,
            "floor": r.floor or "G",
            "room_type": r.room_type,
            "status": status,
            "guest_name": None,
            "stay_name": None,
            "folio_name": None,
            "folio_balance": 0.0,
            "checkin_date": None,
            "expected_checkout": None
        }

    # Attach active stay information to occupied rooms
    active_stays = frappe.get_all("Hotel Stay",
        filters={"status": "Active"},
        fields=["name", "guest", "guest_name", "room", "folio", "checkin_date", "expected_checkout_date", "room_rate"]
    )

    for s in active_stays:
        if s.room in room_map:
            folio_bal = 0.0
            if s.folio:
                folio_bal = frappe.db.get_value("Guest Folio", s.folio, "outstanding_balance") or 0.0

            room_map[s.room].update({
                "guest_name": s.guest_name,
                "stay_name": s.name,
                "folio_name": s.folio,
                "folio_balance": flt(folio_bal, 2),
                "checkin_date": str(s.checkin_date),
                "expected_checkout": str(s.expected_checkout_date)
            })

    occupancy_pct = flt((occupied / total_rooms) * 100, 1) if total_rooms > 0 else 0.0

    # 2. Today's Arrivals
    arrivals = frappe.get_all("Hotel Reservation",
        filters={
            "arrival_date": date_val,
            "status": ["in", ["Draft", "Confirmed"]],
            "docstatus": ["<", 2]
        },
        fields=["name", "guest_name", "contact_phone", "room_type", "assigned_room", "nights", "room_rate", "estimated_total", "advance_paid", "payment_status"]
    )

    # 3. Today's Departures
    departures = frappe.get_all("Hotel Stay",
        filters={
            "expected_checkout_date": date_val,
            "status": "Active"
        },
        fields=["name", "guest_name", "room", "folio", "checkin_date", "expected_checkout_date", "room_rate"]
    )
    for d in departures:
        if d.folio:
            d["balance"] = flt(frappe.db.get_value("Guest Folio", d.folio, "outstanding_balance") or 0.0, 2)
        else:
            d["balance"] = 0.0

    # 4. Revenue & Financials Today
    rev_result = frappe.db.sql("""
        SELECT 
            coalesce(sum(case when charge_type = 'Room Rent' then amount else 0 end), 0) as room_rev,
            coalesce(sum(case when charge_type != 'Room Rent' then amount else 0 end), 0) as extra_rev,
            coalesce(sum(total_amount), 0) as total_rev
        FROM `tabHotel Folio Charge`
        WHERE posting_date = %s
    """, (date_val,), as_dict=True)

    today_revenue = rev_result[0] if rev_result else {"room_rev": 0, "extra_rev": 0, "total_rev": 0}

    # Total outstanding balances from all open folios
    unpaid_result = frappe.db.sql("""
        SELECT coalesce(sum(outstanding_balance), 0) FROM `tabGuest Folio` WHERE status = 'Open'
    """)
    total_unpaid = flt(unpaid_result[0][0]) if unpaid_result and unpaid_result[0][0] else 0.0

    adr = flt(today_revenue["room_rev"] / occupied, 2) if occupied > 0 else 0.0
    revpar = flt(today_revenue["room_rev"] / total_rooms, 2) if total_rooms > 0 else 0.0

    # 5. Pending Housekeeping Tasks
    hk_tasks = frappe.get_all("Housekeeping Task",
        filters={"status": ["in", ["Pending", "In Progress"]]},
        fields=["name", "room", "task_type", "priority", "status", "assigned_to", "assigned_date"],
        order_by="priority desc, assigned_date asc"
    )

    return {
        "date": date_val,
        "kpis": {
            "total_rooms": total_rooms,
            "occupied": occupied,
            "vacant_clean": vacant_clean,
            "vacant_dirty": vacant_dirty,
            "out_of_order": out_of_order,
            "occupancy_pct": occupancy_pct,
            "today_revenue": flt(today_revenue["total_rev"], 2),
            "room_revenue": flt(today_revenue["room_rev"], 2),
            "extra_revenue": flt(today_revenue["extra_rev"], 2),
            "total_unpaid": total_unpaid,
            "adr": adr,
            "revpar": revpar,
            "arrivals_count": len(arrivals),
            "departures_count": len(departures),
            "hk_pending_count": len(hk_tasks)
        },
        "rooms": list(room_map.values()),
        "arrivals": arrivals,
        "departures": departures,
        "housekeeping": hk_tasks
    }

@frappe.whitelist()
def mark_room_clean(room):
    """Instant 1-click update to set room as Vacant Clean"""
    frappe.db.set_value("Hotel Room", room, "status", "Vacant Clean")
    # Also resolve any pending housekeeping task for this room
    pending_tasks = frappe.get_all("Housekeeping Task", filters={"room": room, "status": ["in", ["Pending", "In Progress"]]})
    for t in pending_tasks:
        frappe.db.set_value("Housekeeping Task", t.name, "status", "Completed")
    return {"status": "success", "room": room}

@frappe.whitelist()
def mark_room_dirty(room):
    """Mark room as dirty and trigger housekeeping task"""
    frappe.db.set_value("Hotel Room", room, "status", "Vacant Dirty")
    task = frappe.new_doc("Housekeeping Task")
    task.room = room
    task.task_type = "Daily Cleaning"
    task.priority = "Medium"
    task.assigned_date = today()
    task.insert(ignore_permissions=True)
    return {"status": "success", "room": room}

