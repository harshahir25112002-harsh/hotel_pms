import frappe
from frappe import _
from frappe.utils import flt, getdate, today, add_days, nowdate, now_datetime, date_diff

@frappe.whitelist()
def get_dashboard_data(selected_date=None):
    date_val = selected_date or today()
    curr_date = getdate(date_val)

    # 1. Fetch Rooms & Base Status
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
            "guest_phone": None,
            "stay_name": None,
            "folio_name": None,
            "folio_balance": 0.0,
            "total_charges": 0.0,
            "total_paid": 0.0,
            "checkin_date": None,
            "expected_checkout": None,
            "stay_duration": None,
            "days_elapsed": 0,
            "days_remaining": 0,
            "departure_status": None,
            "is_cleaning_requested": 0
        }

    # 2. Attach Active Stays to Occupied Rooms
    active_stays = frappe.get_all("Hotel Stay",
        filters={"status": "Active"},
        fields=[
            "name", "guest", "guest_name", "room", "room_type", "folio",
            "checkin_date", "expected_checkout_date", "room_rate", "id_proof_type", "id_proof_number"
        ]
    )

    # Check for today's daily cleaning requests
    daily_cleaning_tasks = frappe.get_all("Housekeeping Task",
        filters={
            "task_type": "Daily Cleaning",
            "assigned_date": date_val,
            "status": ["in", ["Pending", "In Progress"]]
        },
        fields=["room"]
    )
    cleaning_requested_rooms = {t.room for t in daily_cleaning_tasks}

    inhouse_list = []
    for s in active_stays:
        cin = getdate(s.checkin_date) if s.checkin_date else curr_date
        cout = getdate(s.expected_checkout_date) if s.expected_checkout_date else add_days(cin, 1)

        total_nights = max(1, date_diff(cout, cin))
        elapsed = max(0, date_diff(curr_date, cin))
        remaining = date_diff(cout, curr_date)

        if remaining < 0:
            dep_status = f"Overstay ({abs(remaining)}d)"
        elif remaining == 0:
            dep_status = "Due Today"
        else:
            dep_status = f"{remaining} day(s) left"

        # Fetch Guest Phone
        phone = frappe.db.get_value("Customer", s.guest, "mobile_no") if s.guest else None

        # Fetch Folio Financials
        folio_bal = 0.0
        tot_charges = 0.0
        tot_paid = 0.0
        if s.folio:
            f_data = frappe.db.get_value("Guest Folio", s.folio, ["grand_total", "total_paid", "outstanding_balance"], as_dict=True)
            if f_data:
                tot_charges = flt(f_data.grand_total, 2)
                tot_paid = flt(f_data.total_paid, 2)
                folio_bal = flt(f_data.outstanding_balance, 2)

        is_cleaning_req = 1 if s.room in cleaning_requested_rooms else 0

        # Room details lookup
        r_num = s.room
        r_floor = "G"
        r_type = s.room_type
        if s.room in room_map:
            r_num = room_map[s.room].get("room_number") or s.room
            r_floor = room_map[s.room].get("floor") or "G"
            r_type = room_map[s.room].get("room_type") or s.room_type
        else:
            for r_val in room_map.values():
                if str(r_val.get("room_number")) == str(s.room):
                    r_num = r_val.get("room_number")
                    r_floor = r_val.get("floor") or "G"
                    r_type = r_val.get("room_type") or s.room_type
                    break

        stay_info = {
            "stay": s.name,
            "guest": s.guest,
            "guest_name": s.guest_name,
            "guest_phone": phone or "N/A",
            "room": s.room,
            "room_number": r_num,
            "floor": r_floor,
            "room_type": r_type,
            "folio": s.folio,
            "checkin_date": str(s.checkin_date),
            "expected_checkout": str(s.expected_checkout_date),
            "room_rate": flt(s.room_rate, 2),
            "id_proof_type": s.id_proof_type or "N/A",
            "id_proof_number": s.id_proof_number or "N/A",
            "total_nights": total_nights,
            "elapsed_nights": elapsed,
            "days_remaining": remaining,
            "departure_status": dep_status,
            "total_charges": tot_charges,
            "total_paid": tot_paid,
            "balance_due": folio_bal,
            "folio_balance": folio_bal,
            "is_cleaning_requested": is_cleaning_req
        }
        inhouse_list.append(stay_info)

        # Robust match in room_map by room name or room_number
        target_room = None
        if s.room in room_map:
            target_room = room_map[s.room]
        else:
            for r_val in room_map.values():
                if str(r_val.get("room_number")) == str(s.room):
                    target_room = r_val
                    break

        if target_room:
            target_room.update({
                "guest_name": s.guest_name,
                "guest_phone": phone or "N/A",
                "stay_name": s.name,
                "folio_name": s.folio,
                "folio_balance": folio_bal,
                "total_charges": tot_charges,
                "total_paid": tot_paid,
                "checkin_date": str(s.checkin_date),
                "expected_checkout": str(s.expected_checkout_date),
                "stay_duration": f"{total_nights} Night(s)",
                "days_elapsed": elapsed,
                "days_remaining": remaining,
                "departure_status": dep_status,
                "is_cleaning_requested": is_cleaning_req
            })

    occupancy_pct = flt((occupied / total_rooms) * 100, 1) if total_rooms > 0 else 0.0

    # 3. Arrivals (Today & Upcoming)
    arrivals = frappe.get_all("Hotel Reservation",
        filters={
            "arrival_date": [">=", date_val],
            "status": ["in", ["Draft", "Confirmed"]],
            "docstatus": ["<", 2]
        },
        fields=[
            "name", "guest", "guest_name", "contact_phone", "room_type",
            "assigned_room", "arrival_date", "departure_date", "nights",
            "room_rate", "estimated_total", "advance_paid", "payment_status", "status"
        ],
        order_by="arrival_date asc"
    )

    # 4. Departures (Due Today or Overstay)
    departures = [s for s in inhouse_list if s["days_remaining"] <= 0]

    # 5. Revenue Today
    rev_result = frappe.db.sql("""
        SELECT 
            coalesce(sum(case when charge_type = 'Room Rent' then amount else 0 end), 0) as room_rev,
            coalesce(sum(case when charge_type != 'Room Rent' then amount else 0 end), 0) as extra_rev,
            coalesce(sum(total_amount), 0) as total_rev
        FROM `tabHotel Folio Charge`
        WHERE posting_date = %s
    """, (date_val,), as_dict=True)

    today_revenue = rev_result[0] if rev_result else {"room_rev": 0, "extra_rev": 0, "total_rev": 0}

    unpaid_result = frappe.db.sql("""
        SELECT coalesce(sum(outstanding_balance), 0) FROM `tabGuest Folio` WHERE status = 'Open'
    """)
    total_unpaid = flt(unpaid_result[0][0]) if unpaid_result and unpaid_result[0][0] else 0.0

    adr = flt(today_revenue["room_rev"] / occupied, 2) if occupied > 0 else 0.0
    revpar = flt(today_revenue["room_rev"] / total_rooms, 2) if total_rooms > 0 else 0.0

    # 6. Housekeeping Tasks (Pending & In Progress)
    hk_tasks = frappe.get_all("Housekeeping Task",
        filters={"status": ["in", ["Pending", "In Progress"]]},
        fields=["name", "room", "task_type", "priority", "status", "assigned_to", "assigned_date", "notes"],
        order_by="priority desc, assigned_date asc"
    )

    # 7. Helper Masters for Quick Modals
    room_types = frappe.get_all("Hotel Room Type", fields=["name", "base_rate"])
    payment_modes = [d.name for d in frappe.get_all("Mode of Payment", filters={"enabled": 1}, order_by="name asc")]
    if not payment_modes:
        payment_modes = ["Cash", "Bank", "UPI", "Credit Card"]

    clean_rooms = [r for r in room_map.values() if r["status"] == "Vacant Clean"]

    charge_types = [
        "Restaurant / F&B",
        "Laundry",
        "Room Service",
        "Minibar",
        "Extra Bed",
        "Airport Transfer",
        "Late Checkout",
        "Spa / Wellness",
        "Other"
    ]

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
            "arrivals_count": len([a for a in arrivals if str(a.arrival_date) == str(date_val)]),
            "departures_count": len(departures),
            "hk_pending_count": len(hk_tasks),
            "inhouse_count": len(inhouse_list)
        },
        "rooms": list(room_map.values()),
        "arrivals": arrivals,
        "departures": departures,
        "inhouse": inhouse_list,
        "housekeeping": hk_tasks,
        "masters": {
            "room_types": room_types,
            "payment_modes": payment_modes,
            "clean_rooms": clean_rooms,
            "charge_types": charge_types
        }
    }

def create_hotel_payment_entry(company, customer, amount, mode_of_payment=None, hotel_stay=None, hotel_reservation=None, hotel_folio=None, reference_no=None):
    """Safely create and submit an ERPNext Payment Entry without lifecycle attribute errors"""
    pe = frappe.new_doc("Payment Entry")
    pe.payment_type = "Receive"
    pe.party_type = "Customer"
    pe.party = customer
    pe.company = company
    pe.paid_amount = flt(amount)
    pe.received_amount = flt(amount)

    if hotel_stay:
        pe.hotel_stay = hotel_stay
    if hotel_reservation:
        pe.hotel_reservation = hotel_reservation
    if hotel_folio:
        pe.hotel_folio = hotel_folio
    if mode_of_payment:
        pe.mode_of_payment = mode_of_payment
    if reference_no:
        pe.reference_no = reference_no
        pe.reference_date = today()

    # 1. Resolve customer receivable account (paid_from)
    try:
        from erpnext.accounts.party import get_party_account
        party_account = get_party_account("Customer", customer, company)
        if party_account:
            pe.paid_from = party_account
    except Exception:
        pass

    # 2. Resolve Bank / Cash account from Mode of Payment or Company defaults (paid_to)
    if mode_of_payment:
        try:
            from erpnext.accounts.doctype.sales_invoice.sales_invoice import get_bank_cash_account
            bank_acc = get_bank_cash_account(mode_of_payment, company)
            if bank_acc and bank_acc.get("account"):
                pe.paid_to = bank_acc.get("account")
        except Exception:
            pass

    if not getattr(pe, "paid_to", None):
        pe.paid_to = frappe.db.get_value("Company", company, "default_cash_account") or frappe.db.get_value("Company", company, "default_bank_account")

    # 3. Setup lifecycle fields in proper sequence before set_missing_values
    if hasattr(pe, "setup_party_account_field"):
        pe.setup_party_account_field()

    if hasattr(pe, "set_missing_values"):
        try:
            pe.set_missing_values()
        except Exception:
            pass

    pe.insert(ignore_permissions=True)
    pe.submit()
    return pe

@frappe.whitelist()
def quick_walkin_checkin(guest_name, room, room_rate=None, phone=None, email=None, checkin_date=None, expected_checkout_date=None, advance_amount=0, mode_of_payment=None, id_proof_type=None, id_proof_number=None):
    """Direct 1-click Walk-In Check-In from the dashboard"""
    if not guest_name:
        frappe.throw(_("Guest Name is mandatory."))
    if not room:
        frappe.throw(_("Room is mandatory."))

    # Validate room status
    room_data = frappe.db.get_value("Hotel Room", room, ["status", "room_type"], as_dict=True)
    if not room_data:
        frappe.throw(_("Room {0} not found.").format(room))
    if room_data.status != "Vacant Clean":
        frappe.throw(_("Room {0} is currently '{1}'. Only 'Vacant Clean' rooms can be checked in.").format(room, room_data.status))

    # 1. Resolve or Create Customer (Guest)
    customer_name = guest_name.strip()
    customer = frappe.db.get_value("Customer", {"customer_name": customer_name}, "name")
    if not customer:
        cust_doc = frappe.new_doc("Customer")
        cust_doc.customer_name = customer_name
        cust_doc.customer_type = "Individual"
        cust_doc.customer_group = frappe.db.get_single_value("Selling Settings", "customer_group") or "Individual"
        cust_doc.territory = frappe.db.get_single_value("Selling Settings", "territory") or "All Territories"
        cust_doc.is_hotel_guest = 1
        if phone:
            cust_doc.mobile_no = phone
        if email:
            cust_doc.email_id = email
        cust_doc.flags.ignore_mandatory = True
        cust_doc.insert(ignore_permissions=True)
        customer = cust_doc.name
    else:
        if phone:
            frappe.db.set_value("Customer", customer, "mobile_no", phone)

    # 2. Resolve Company & Room Rate
    settings = frappe.get_single("Hotel Settings")
    company = settings.company or frappe.defaults.get_user_default("Company")
    if not company:
        company = frappe.db.get_value("Company", {}, "name")

    if not room_rate:
        room_rate = frappe.db.get_value("Hotel Room Type", room_data.room_type, "base_rate") or 0.0

    cin_date = checkin_date or today()
    cout_date = expected_checkout_date or add_days(cin_date, 1)

    # 3. Create Hotel Stay
    stay = frappe.new_doc("Hotel Stay")
    stay.guest = customer
    stay.room = room
    stay.room_type = room_data.room_type
    stay.company = company
    stay.checkin_date = cin_date
    stay.expected_checkout_date = cout_date
    stay.room_rate = flt(room_rate)
    stay.adults = 1
    stay.status = "Active"
    if id_proof_type:
        stay.id_proof_type = id_proof_type
    if id_proof_number:
        stay.id_proof_number = id_proof_number

    stay.insert(ignore_permissions=True)

    # 4. Record Advance Payment if entered
    adv = flt(advance_amount)
    if adv > 0:
        try:
            create_hotel_payment_entry(
                company=company,
                customer=customer,
                amount=adv,
                mode_of_payment=mode_of_payment,
                hotel_stay=stay.name,
                hotel_folio=stay.folio,
                reference_no="Advance at Check-In"
            )
            # Refresh folio payment fetch
            if stay.folio:
                folio_doc = frappe.get_doc("Guest Folio", stay.folio)
                folio_doc.fetch_payments()
                folio_doc.save(ignore_permissions=True)
        except Exception as e:
            frappe.log_error(f"Error recording advance on quick checkin: {e}")

    return {
        "status": "success",
        "stay": stay.name,
        "room": room,
        "guest": customer_name
    }

@frappe.whitelist()
def quick_create_reservation(guest_name, arrival_date, departure_date, room_type, assigned_room=None, room_rate=None, phone=None, email=None, advance_amount=0, mode_of_payment=None):
    """Direct 1-click Advance Reservation from Dashboard"""
    if not guest_name:
        frappe.throw(_("Guest Name is mandatory."))
    if not arrival_date or not departure_date:
        frappe.throw(_("Arrival and Departure dates are mandatory."))
    if not room_type:
        frappe.throw(_("Room Type is mandatory."))

    # Resolve or create Customer
    customer_name = guest_name.strip()
    customer = frappe.db.get_value("Customer", {"customer_name": customer_name}, "name")
    if not customer:
        cust_doc = frappe.new_doc("Customer")
        cust_doc.customer_name = customer_name
        cust_doc.customer_type = "Individual"
        cust_doc.is_hotel_guest = 1
        if phone:
            cust_doc.mobile_no = phone
        if email:
            cust_doc.email_id = email
        cust_doc.flags.ignore_mandatory = True
        cust_doc.insert(ignore_permissions=True)
        customer = cust_doc.name

    settings = frappe.get_single("Hotel Settings")
    company = settings.company or frappe.defaults.get_user_default("Company") or frappe.db.get_value("Company", {}, "name")

    if not room_rate:
        room_rate = frappe.db.get_value("Hotel Room Type", room_type, "base_rate") or 0.0

    res = frappe.new_doc("Hotel Reservation")
    res.guest = customer
    res.company = company
    res.arrival_date = arrival_date
    res.departure_date = departure_date
    res.room_type = room_type
    if assigned_room:
        res.assigned_room = assigned_room
    res.room_rate = flt(room_rate)
    res.status = "Confirmed"
    res.insert(ignore_permissions=True)
    res.submit()

    # Record advance payment if collected
    adv = flt(advance_amount)
    if adv > 0:
        try:
            create_hotel_payment_entry(
                company=company,
                customer=customer,
                amount=adv,
                mode_of_payment=mode_of_payment,
                hotel_reservation=res.name,
                reference_no="Advance for Reservation"
            )
            res.db_set("advance_paid", adv)
            res.db_set("payment_status", "Partially Paid" if adv < res.estimated_total else "Fully Paid")
        except Exception as e:
            frappe.log_error(f"Error recording reservation advance payment: {e}")

    return {
        "status": "success",
        "reservation": res.name,
        "guest": customer_name
    }

@frappe.whitelist()
def add_folio_charge(stay=None, folio=None, charge_type=None, amount=0, description=None, qty=1, **kwargs):
    """Add extra charge (Food, Laundry, Minibar, etc.) to Folio from Dashboard"""
    if not folio and stay:
        folio = frappe.db.get_value("Hotel Stay", stay, "folio")

    if not folio:
        frappe.throw(_("No Guest Folio found for this stay."))

    rate_val = flt(amount)
    if rate_val <= 0:
        frappe.throw(_("Charge amount must be greater than zero."))

    folio_doc = frappe.get_doc("Guest Folio", folio)
    room = frappe.db.get_value("Hotel Stay", folio_doc.stay, "room") if folio_doc.stay else None

    # Resolve default item
    settings = frappe.get_single("Hotel Settings")
    item_code = settings.room_rent_item if charge_type == "Room Rent" else None
    if not item_code:
        item_code = frappe.db.get_value("Item", {"is_sales_item": 1}, "name")

    folio_doc.append("charges", {
        "posting_date": today(),
        "charge_type": charge_type or "Restaurant / F&B",
        "item": item_code,
        "description": description or f"{charge_type} charge",
        "room": room,
        "qty": flt(qty) or 1.0,
        "rate": rate_val
    })
    folio_doc.calculate_totals()
    folio_doc.fetch_payments()
    folio_doc.save(ignore_permissions=True)

    return {
        "status": "success",
        "folio": folio,
        "grand_total": folio_doc.grand_total,
        "total_paid": folio_doc.total_paid,
        "balance_due": folio_doc.outstanding_balance
    }

@frappe.whitelist()
def collect_stay_payment(stay=None, folio=None, amount=0, mode_of_payment=None, reference_no=None, **kwargs):
    """Record a Payment Entry directly against the in-house stay and folio"""
    if not stay and folio:
        stay = frappe.db.get_value("Guest Folio", folio, "stay")

    if not stay:
        frappe.throw(_("Stay ID is required."))

    stay_doc = frappe.get_doc("Hotel Stay", stay)
    pay_amount = flt(amount)
    if pay_amount <= 0:
        frappe.throw(_("Payment amount must be greater than zero."))

    settings = frappe.get_single("Hotel Settings")
    company = stay_doc.company or settings.company or frappe.defaults.get_user_default("Company")

    pe = create_hotel_payment_entry(
        company=company,
        customer=stay_doc.guest,
        amount=pay_amount,
        mode_of_payment=mode_of_payment,
        hotel_stay=stay_doc.name,
        hotel_folio=stay_doc.folio,
        reference_no=reference_no or "Stay Payment"
    )

    # Recalculate Folio
    balance_left = 0.0
    if stay_doc.folio:
        f_doc = frappe.get_doc("Guest Folio", stay_doc.folio)
        f_doc.fetch_payments()
        f_doc.save(ignore_permissions=True)
        balance_left = f_doc.outstanding_balance

    return {
        "status": "success",
        "payment_entry": pe.name,
        "amount_paid": pay_amount,
        "balance_due": balance_left
    }

@frappe.whitelist()
def request_daily_cleaning(room, stay=None, notes=None):
    """1-Click daily housekeeping request for multi-day guest stay"""
    existing = frappe.db.sql("""
        SELECT name FROM `tabHousekeeping Task`
        WHERE room = %s AND assigned_date = %s AND task_type = 'Daily Cleaning' AND status in ('Pending', 'In Progress')
    """, (room, today()))

    if existing:
        return {"status": "already_exists", "message": f"Daily cleaning task already scheduled for Room {room} today."}

    task = frappe.new_doc("Housekeeping Task")
    task.room = room
    task.task_type = "Daily Cleaning"
    task.priority = "Medium"
    task.status = "Pending"
    task.assigned_date = today()
    task.notes = notes or f"Daily morning guest cleaning requested for Room {room}"
    task.insert(ignore_permissions=True)

    return {"status": "success", "task": task.name, "room": room}

@frappe.whitelist()
def instant_checkout(stay, settle_balance=0, mode_of_payment=None):
    """1-Click Checkout: Settle outstanding balance (if selected) and finalize checkout"""
    stay_doc = frappe.get_doc("Hotel Stay", stay)

    if stay_doc.status == "Checked Out":
        frappe.throw(_("This stay is already checked out."))

    if not stay_doc.folio:
        frappe.throw(_("No Folio found for this stay."))

    folio_doc = frappe.get_doc("Guest Folio", stay_doc.folio)
    folio_doc.calculate_totals()
    folio_doc.fetch_payments()

    # Auto-settle balance if requested
    rem_bal = folio_doc.outstanding_balance
    if rem_bal > 0:
        if flt(settle_balance) > 0 and mode_of_payment:
            collect_stay_payment(
                stay=stay,
                amount=rem_bal,
                mode_of_payment=mode_of_payment,
                reference_no="Settled at Checkout"
            )
        else:
            frappe.throw(_("Folio has an outstanding balance of {0}. Please collect payment to proceed.").format(rem_bal))

    # Run checkout logic
    res = stay_doc.process_checkout()
    return res

@frappe.whitelist()
def checkin_reservation(reservation, room=None):
    """Check-in an existing reservation from the dashboard"""
    res_doc = frappe.get_doc("Hotel Reservation", reservation)
    return res_doc.create_check_in(room=room)

@frappe.whitelist()
def mark_room_clean(room):
    """Instant 1-click update to set room as Vacant Clean"""
    frappe.db.set_value("Hotel Room", room, "status", "Vacant Clean")
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

@frappe.whitelist()
def get_available_rooms():
    """Return clean vacant rooms for quick selection"""
    return frappe.get_all("Hotel Room",
        filters={"status": "Vacant Clean", "is_active": 1},
        fields=["name", "room_number", "floor", "room_type"],
        order_by="room_number asc"
    )
