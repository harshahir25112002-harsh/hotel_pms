frappe.pages["hotel_dashboard"].on_page_load = function (wrapper) {
    let page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __("Front Desk & Room Rack"),
        single_column: true
    });

    wrapper.hotel_dashboard = new HotelDashboard(page);
};

frappe.pages["hotel_dashboard"].on_page_show = function (wrapper) {
    if (wrapper.hotel_dashboard) {
        wrapper.hotel_dashboard.load_data();
    }
};

class HotelDashboard {
    constructor(page) {
        this.page = page;
        this.data = {};
        this.active_filter = "All";
        this.search_query = "";
        this.selected_date = frappe.datetime.get_today();

        this.init();
    }

    init() {
        this.page.clear_actions();
        this.page.clear_custom_actions();
        this.setup_dom();
        this.load_data();
    }

    setup_dom() {
        this.$wrapper = $(`
            <div class="hotel-dashboard-container">
                <!-- Header Bar -->
                <div class="hotel-header-bar">
                    <div class="hotel-brand-title">
                        <div class="hotel-brand-icon">🏨</div>
                        <div class="hotel-brand-text">
                            <h1>${__("Front Desk Operations")}</h1>
                            <p id="live-datetime">${frappe.datetime.str_to_user(this.selected_date)} · ${__("Room Rack & Operations")}</p>
                        </div>
                    </div>
                    <div class="hotel-header-actions">
                        <button class="btn-hotel-primary" id="btn-quick-walkin">
                            ⚡ ${__("Walk-In Check-In")}
                        </button>
                        <button class="btn-hotel-accent" id="btn-new-reservation">
                            📅 ${__("New Reservation")}
                        </button>
                        <button class="btn-hotel-outline" id="btn-refresh-data">
                            🔄 ${__("Refresh")}
                        </button>
                    </div>
                </div>

                <!-- KPI Metric Cards -->
                <div class="kpi-grid" id="kpi-cards"></div>

                <!-- Filter & Search Toolbar -->
                <div class="hotel-toolbar">
                    <div class="filter-pills-group" id="filter-pills">
                        <button class="filter-pill active" data-filter="All">${__("All Rooms")}</button>
                        <button class="filter-pill" data-filter="Vacant Clean">🟢 ${__("Vacant Clean")} <span id="cnt-clean" class="badge">0</span></button>
                        <button class="filter-pill" data-filter="Occupied">🟣 ${__("Occupied")} <span id="cnt-occ" class="badge">0</span></button>
                        <button class="filter-pill" data-filter="Vacant Dirty">🟡 ${__("Vacant Dirty")} <span id="cnt-dirty" class="badge">0</span></button>
                        <button class="filter-pill" data-filter="Out of Order">⚪ ${__("Out of Order")} <span id="cnt-ooo" class="badge">0</span></button>
                    </div>
                    <div class="search-box-wrapper">
                        <span class="search-icon">🔍</span>
                        <input type="text" class="dash-search-input" id="room-search-input" placeholder="${__("Search Room #, Guest, Phone...")}">
                    </div>
                </div>

                <!-- Room Rack Grid -->
                <div class="room-grid" id="room-matrix"></div>

                <!-- Operations Tabs -->
                <div class="dash-tabs-container">
                    <div class="dash-tabs-nav">
                        <div class="dash-tab-btn active" data-tab="arrivals">
                            🛬 ${__("Today & Upcoming Arrivals")} <span class="dash-tab-count" id="badge-arrivals">0</span>
                        </div>
                        <div class="dash-tab-btn" data-tab="departures">
                            🛫 ${__("Today's Departures")} <span class="dash-tab-count" id="badge-departures">0</span>
                        </div>
                        <div class="dash-tab-btn" data-tab="inhouse">
                            👥 ${__("In-House Guests")} <span class="dash-tab-count" id="badge-inhouse">0</span>
                        </div>
                        <div class="dash-tab-btn" data-tab="housekeeping">
                            🧹 ${__("Housekeeping Queue")} <span class="dash-tab-count" id="badge-hk">0</span>
                        </div>
                    </div>
                    <div class="dash-tab-content active" id="pane-arrivals"></div>
                    <div class="dash-tab-content" id="pane-departures"></div>
                    <div class="dash-tab-content" id="pane-inhouse"></div>
                    <div class="dash-tab-content" id="pane-housekeeping"></div>
                </div>
            </div>
        `).appendTo(this.page.main);

        this.bind_events();
    }

    bind_events() {
        // Quick Walk-In Button
        this.$wrapper.on("click", "#btn-quick-walkin", () => {
            this.open_walkin_checkin_dialog();
        });

        // New Reservation Button
        this.$wrapper.on("click", "#btn-new-reservation", () => {
            this.open_new_reservation_dialog();
        });

        // Refresh Data Button
        this.$wrapper.on("click", "#btn-refresh-data", () => {
            this.load_data();
        });

        // Live Search Input
        this.$wrapper.on("input", "#room-search-input", (e) => {
            this.search_query = $(e.target).val().toLowerCase().trim();
            this.render_rooms();
        });

        // Filter Pills
        this.$wrapper.on("click", ".filter-pill", (e) => {
            this.$wrapper.find(".filter-pill").removeClass("active");
            $(e.currentTarget).addClass("active");
            this.active_filter = $(e.currentTarget).data("filter");
            this.render_rooms();
        });

        // Tab Switching
        this.$wrapper.on("click", ".dash-tab-btn", (e) => {
            let tab = $(e.currentTarget).data("tab");
            this.$wrapper.find(".dash-tab-btn").removeClass("active");
            this.$wrapper.find(".dash-tab-content").removeClass("active");
            $(e.currentTarget).addClass("active");
            this.$wrapper.find(`#pane-${tab}`).addClass("active");
        });

        // Room Card Click
        this.$wrapper.on("click", ".room-card", (e) => {
            let room = String($(e.currentTarget).attr("data-room") || "").trim();
            let status = String($(e.currentTarget).attr("data-status") || "").trim();
            let stay = String($(e.currentTarget).attr("data-stay") || "").trim();

            if (status === "Vacant Clean") {
                this.open_walkin_checkin_dialog(room);
            } else if (status === "Occupied") {
                this.open_inhouse_dialog(room, stay);
            } else if (status === "Vacant Dirty") {
                frappe.confirm(__("Room {0} is dirty. Mark clean and ready for guests?", [room]), () => {
                    this.mark_clean(room);
                });
            } else {
                frappe.set_route("Form", "Hotel Room", room);
            }
        });

        // Stop propagation for action buttons inside room cards
        this.$wrapper.on("click", ".card-btn", (e) => {
            e.stopPropagation();
            let action = String($(e.currentTarget).attr("data-action") || "").trim();
            let room = String($(e.currentTarget).attr("data-room") || "").trim();
            let stay = String($(e.currentTarget).attr("data-stay") || "").trim();

            if (action === "checkin") {
                this.open_walkin_checkin_dialog(room);
            } else if (action === "clean") {
                this.mark_clean(room);
            } else if (action === "charge") {
                this.open_add_charge_dialog(stay, room);
            } else if (action === "checkout") {
                this.open_checkout_dialog(stay, room);
            }
        });
    }

    load_data() {
        frappe.call({
            method: "hotel_pms.hotel_pms.page.hotel_dashboard.hotel_dashboard.get_dashboard_data",
            args: { selected_date: this.selected_date },
            callback: (r) => {
                if (r.message) {
                    this.data = r.message;
                    this.render_kpis();
                    this.render_rooms();
                    this.render_arrivals();
                    this.render_departures();
                    this.render_inhouse();
                    this.render_housekeeping();
                }
            }
        });
    }

    render_kpis() {
        let k = this.data.kpis;
        let currency = frappe.defaults.get_default("currency") || "₹";

        let html = `
            <div class="kpi-card kpi-occupancy">
                <div class="kpi-title">${__("Occupancy Rate")}</div>
                <div class="kpi-value">${k.occupancy_pct}%</div>
                <div class="kpi-sub">${k.occupied} / ${k.total_rooms} ${__("Rooms Occupied")}</div>
            </div>
            <div class="kpi-card kpi-clean">
                <div class="kpi-title">${__("Vacant Clean")}</div>
                <div class="kpi-value">${k.vacant_clean}</div>
                <div class="kpi-sub">${__("Ready to Sell")}</div>
            </div>
            <div class="kpi-card kpi-occupied">
                <div class="kpi-title">${__("In-House Guests")}</div>
                <div class="kpi-value">${k.occupied}</div>
                <div class="kpi-sub">${k.inhouse_count} ${__("Active Stays")}</div>
            </div>
            <div class="kpi-card kpi-dirty">
                <div class="kpi-title">${__("Vacant Dirty")}</div>
                <div class="kpi-value">${k.vacant_dirty}</div>
                <div class="kpi-sub">${__("Awaiting Cleaning")}</div>
            </div>
            <div class="kpi-card kpi-revenue">
                <div class="kpi-title">${__("Today's Revenue")}</div>
                <div class="kpi-value">${format_currency(k.today_revenue, currency)}</div>
                <div class="kpi-sub">ADR: ${format_currency(k.adr, currency)} · RevPAR: ${format_currency(k.revpar, currency)}</div>
            </div>
            <div class="kpi-card kpi-dues">
                <div class="kpi-title">${__("Pending Dues")}</div>
                <div class="kpi-value">${format_currency(k.total_unpaid, currency)}</div>
                <div class="kpi-sub">${__("Uncollected Balances")}</div>
            </div>
        `;
        this.$wrapper.find("#kpi-cards").html(html);

        // Update counts
        this.$wrapper.find("#cnt-clean").text(k.vacant_clean);
        this.$wrapper.find("#cnt-occ").text(k.occupied);
        this.$wrapper.find("#cnt-dirty").text(k.vacant_dirty);
        this.$wrapper.find("#cnt-ooo").text(k.out_of_order);

        this.$wrapper.find("#badge-arrivals").text(k.arrivals_count);
        this.$wrapper.find("#badge-departures").text(k.departures_count);
        this.$wrapper.find("#badge-inhouse").text(k.inhouse_count);
        this.$wrapper.find("#badge-hk").text(k.hk_pending_count);
    }

    render_rooms() {
        let rooms = this.data.rooms || [];

        // Apply Status Filter
        if (this.active_filter !== "All") {
            rooms = rooms.filter(r => r.status === this.active_filter);
        }

        // Apply Search Query
        if (this.search_query) {
            let q = this.search_query;
            rooms = rooms.filter(r => {
                let rNum = (r.room_number || "").toLowerCase();
                let gName = (r.guest_name || "").toLowerCase();
                let gPhone = (r.guest_phone || "").toLowerCase();
                let rType = (r.room_type || "").toLowerCase();
                return rNum.includes(q) || gName.includes(q) || gPhone.includes(q) || rType.includes(q);
            });
        }

        let html = "";
        let currency = frappe.defaults.get_default("currency") || "₹";

        rooms.forEach(r => {
            let status_class = "status-" + r.status.toLowerCase().replace(/ /g, "-");
            let badge_class = "badge-clean";
            if (r.status === "Vacant Dirty") badge_class = "badge-dirty";
            if (r.status === "Occupied") badge_class = "badge-occupied";
            if (r.status === "Out of Order") badge_class = "badge-ooo";

            html += `
                <div class="room-card ${status_class}" data-room="${r.room}" data-stay="${r.stay_name || ''}" data-status="${r.status}">
                    <div>
                        <div class="room-card-header">
                            <span class="room-number">${r.room_number}</span>
                            <span class="room-badge ${badge_class}">${r.status}</span>
                        </div>
                        <div class="room-type">${r.room_type} · Floor ${r.floor}</div>

                        ${r.status === 'Occupied' ? `
                            <div class="room-guest-info">
                                <div class="room-guest-name">👤 ${frappe.utils.escape_html(r.guest_name || 'In-House')}</div>
                                <div class="room-stay-details">
                                    <span>${r.stay_duration || '1 Night'}</span>
                                    <span>${r.departure_status ? `<span class="pill-alert">${r.departure_status}</span>` : ''}</span>
                                </div>
                                <div style="display:flex; justify-content:space-between; align-items:center;">
                                    ${r.folio_balance > 0 ?
                        `<span class="room-folio-pill pill-due">Due: ${format_currency(r.folio_balance, currency)}</span>` :
                        `<span class="room-folio-pill pill-settled">✓ Paid</span>`
                    }
                                    ${r.is_cleaning_requested ? `<span title="Morning cleaning requested" style="font-size:14px;">🧹</span>` : ''}
                                </div>
                            </div>
                        ` : ''}

                        ${r.status === 'Vacant Clean' ? `
                            <div style="font-size: 11px; color: #10b981; font-weight: 600; margin-top: 6px;">✨ Ready for Guest</div>
                        ` : ''}

                        ${r.status === 'Vacant Dirty' ? `
                            <div style="font-size: 11px; color: #b45309; font-weight: 600; margin-top: 6px;">🧹 Needs Turnover Cleaning</div>
                        ` : ''}
                    </div>

                    <div class="room-card-actions">
                        ${r.status === 'Vacant Clean' ? `
                            <button class="card-btn btn-card-checkin" data-action="checkin" data-room="${r.room}">⚡ ${__("Check-In")}</button>
                        ` : ''}

                        ${r.status === 'Vacant Dirty' ? `
                            <button class="card-btn btn-card-clean" data-action="clean" data-room="${r.room}">✓ ${__("Mark Clean")}</button>
                        ` : ''}

                        ${r.status === 'Occupied' ? `
                            <button class="card-btn btn-card-charge" data-action="charge" data-stay="${r.stay_name}" data-room="${r.room}">➕ ${__("Charge")}</button>
                            <button class="card-btn btn-card-checkout" data-action="checkout" data-stay="${r.stay_name}" data-room="${r.room}">🚪 ${__("Out")}</button>
                        ` : ''}
                    </div>
                </div>
            `;
        });

        if (rooms.length === 0) {
            html = `<div class="text-muted p-4 col-span-full" style="grid-column: 1 / -1; text-align: center; background: #ffffff; border-radius: 12px; border: 1px dashed #cbd5e1;">${__("No rooms match the selected criteria.")}</div>`;
        }

        this.$wrapper.find("#room-matrix").html(html);
    }

    // ----------------------------------------------------------------------
    // Modal: Quick Walk-In Check-In (Clean Room)
    // ----------------------------------------------------------------------
    open_walkin_checkin_dialog(prefill_room) {
        let clean_rooms = (this.data.masters && this.data.masters.clean_rooms) || [];
        let room_options = clean_rooms.map(x => ({ label: `Room ${x.room_number} (${x.room_type})`, value: x.room }));
        let payment_modes = (this.data.masters && this.data.masters.payment_modes) || ["Cash", "Bank", "UPI", "Credit Card"];

        let default_room = prefill_room || (clean_rooms[0] ? clean_rooms[0].room : "");
        let sel_room_info = clean_rooms.find(x => x.room === default_room);
        let default_rate = 3500;
        if (sel_room_info && this.data.masters && this.data.masters.room_types) {
            let rt = this.data.masters.room_types.find(t => t.name === sel_room_info.room_type);
            if (rt) default_rate = rt.base_rate;
        }

        let d = new frappe.ui.Dialog({
            title: __("⚡ Quick Walk-In Check-In"),
            fields: [
                {
                    label: __("Select Clean Room"),
                    fieldname: "room",
                    fieldtype: "Select",
                    options: room_options,
                    default: default_room,
                    reqd: 1,
                    onchange: () => {
                        let rVal = d.get_value("room");
                        let rObj = clean_rooms.find(x => x.room === rVal);
                        if (rObj && this.data.masters && this.data.masters.room_types) {
                            let rt = this.data.masters.room_types.find(t => t.name === rObj.room_type);
                            if (rt) {
                                d.set_value("room_rate", rt.base_rate);
                                d.set_value("room_type", rObj.room_type);
                            }
                        }
                    }
                },
                {
                    label: __("Daily Room Rate (₹)"),
                    fieldname: "room_rate",
                    fieldtype: "Currency",
                    default: default_rate,
                    reqd: 1
                },
                { fieldtype: "Column Break" },
                {
                    label: __("Check-In Date"),
                    fieldname: "checkin_date",
                    fieldtype: "Date",
                    default: frappe.datetime.get_today(),
                    reqd: 1
                },
                {
                    label: __("Expected Checkout Date"),
                    fieldname: "expected_checkout_date",
                    fieldtype: "Date",
                    default: frappe.datetime.add_days(frappe.datetime.get_today(), 1),
                    reqd: 1
                },
                { fieldtype: "Section Break", label: __("Guest Details") },
                {
                    label: __("Guest Full Name"),
                    fieldname: "guest_name",
                    fieldtype: "Data",
                    reqd: 1,
                    placeholder: "e.g. John Doe"
                },
                {
                    label: __("Mobile Number"),
                    fieldname: "phone",
                    fieldtype: "Data",
                    reqd: 1,
                    placeholder: "e.g. 9876543210"
                },
                { fieldtype: "Column Break" },
                {
                    label: __("ID Proof Type"),
                    fieldname: "id_proof_type",
                    fieldtype: "Select",
                    options: ["Aadhaar", "Passport", "Driving License", "Voter ID", "PAN", "Other"],
                    default: "Aadhaar"
                },
                {
                    label: __("ID Proof Number"),
                    fieldname: "id_proof_number",
                    fieldtype: "Data",
                    placeholder: "e.g. 1234 5678 9012"
                },
                { fieldtype: "Section Break", label: __("Advance Payment (Optional)") },
                {
                    label: __("Advance Amount Paid (₹)"),
                    fieldname: "advance_amount",
                    fieldtype: "Currency",
                    default: 0
                },
                {
                    label: __("Payment Mode"),
                    fieldname: "mode_of_payment",
                    fieldtype: "Select",
                    options: payment_modes,
                    default: payment_modes[0] || "Cash"
                }
            ],
            primary_action_label: __("Complete Check-In"),
            primary_action: (vals) => {
                // Validation: Guest Name
                let gName = (vals.guest_name || "").trim();
                if (!gName || gName.length < 2) {
                    frappe.msgprint(__("Please enter a valid Guest Full Name (minimum 2 characters)."));
                    return false;
                }

                // Validation: Mobile Number (10-15 digits)
                let rawPhone = (vals.phone || "").trim();
                let cleanPhone = rawPhone.replace(/\D/g, "");
                if (!rawPhone || cleanPhone.length < 10 || cleanPhone.length > 15) {
                    frappe.msgprint(__("Please enter a valid Mobile Number (10 to 15 digits)."));
                    return false;
                }

                // Validation: Email (if entered)
                if (vals.email && vals.email.trim()) {
                    let emailTrim = vals.email.trim();
                    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
                        frappe.msgprint(__("Please enter a valid Email Address."));
                        return false;
                    }
                }

                // Validation: Dates
                if (vals.checkin_date && vals.expected_checkout_date) {
                    if (frappe.datetime.str_to_obj(vals.expected_checkout_date) < frappe.datetime.str_to_obj(vals.checkin_date)) {
                        frappe.msgprint(__("Expected Checkout Date cannot be before Check-in Date."));
                        return false;
                    }
                }

                // Validation: Room Rate
                if (flt(vals.room_rate) <= 0) {
                    frappe.msgprint(__("Daily Room Rate must be greater than zero."));
                    return false;
                }

                // Validation: Advance Amount
                if (flt(vals.advance_amount) < 0) {
                    frappe.msgprint(__("Advance Amount cannot be negative."));
                    return false;
                }

                // Validation: KYC Document
                if (vals.id_proof_type && vals.id_proof_number) {
                    let idNum = vals.id_proof_number.trim().replace(/\s+/g, "");
                    if (vals.id_proof_type === "Aadhaar" && (!/^\d{12}$/.test(idNum))) {
                        frappe.msgprint(__("Aadhaar Card number must be exactly 12 digits."));
                        return false;
                    }
                    if (vals.id_proof_type === "PAN" && (!/^[A-Za-z]{5}\d{4}[A-Za-z]{1}$/.test(idNum))) {
                        frappe.msgprint(__("Invalid PAN Card format (expected e.g. ABCDE1234F)."));
                        return false;
                    }
                }

                frappe.call({
                    method: "hotel_pms.hotel_pms.page.hotel_dashboard.hotel_dashboard.quick_walkin_checkin",
                    args: vals,
                    freeze: true,
                    freeze_message: __("Checking in guest & locking room..."),
                    callback: (r) => {
                        if (r.message && r.message.status === "success") {
                            d.hide();
                            frappe.show_alert({
                                message: __("Guest {0} successfully checked in to Room {1}!", [r.message.guest, r.message.room]),
                                indicator: "green"
                            });
                            this.load_data();
                        }
                    }
                });
            }
        });
        d.show();
    }

    // ----------------------------------------------------------------------
    // Modal: In-House Guest Management & Living Experience
    // ----------------------------------------------------------------------
    open_inhouse_dialog(room, stay) {
        room = String(room || "").trim();
        stay = String(stay || "").trim();

        // 1. Find from rooms array
        let r_info = (this.data.rooms || []).find(x =>
            String(x.room).trim() === room ||
            String(x.room_number).trim() === room ||
            (stay && String(x.stay_name).trim() === stay)
        ) || {};

        // 2. Also match from inhouse array
        let inhouse_info = (this.data.inhouse || []).find(x =>
            (stay && String(x.stay).trim() === stay) ||
            String(x.room).trim() === room ||
            String(x.room_number).trim() === room
        );

        if (inhouse_info) {
            r_info = Object.assign({}, inhouse_info, r_info);
            if (!r_info.guest_name && inhouse_info.guest_name) r_info.guest_name = inhouse_info.guest_name;
            if (!r_info.guest_phone && inhouse_info.guest_phone) r_info.guest_phone = inhouse_info.guest_phone;
            if (!r_info.room_number && inhouse_info.room_number) r_info.room_number = inhouse_info.room_number;
            if (!r_info.room_type && inhouse_info.room_type) r_info.room_type = inhouse_info.room_type;
            if (!r_info.floor && inhouse_info.floor) r_info.floor = inhouse_info.floor;
            if (!r_info.checkin_date && inhouse_info.checkin_date) r_info.checkin_date = inhouse_info.checkin_date;
            if (!r_info.expected_checkout && inhouse_info.expected_checkout) r_info.expected_checkout = inhouse_info.expected_checkout;
            if (r_info.total_charges === undefined || r_info.total_charges === 0) r_info.total_charges = inhouse_info.total_charges;
            if (r_info.total_paid === undefined || r_info.total_paid === 0) r_info.total_paid = inhouse_info.total_paid;
            if (r_info.folio_balance === undefined) r_info.folio_balance = inhouse_info.balance_due !== undefined ? inhouse_info.balance_due : inhouse_info.folio_balance;
            if (!r_info.departure_status && inhouse_info.departure_status) r_info.departure_status = inhouse_info.departure_status;
        }

        let display_room_no = r_info.room_number || room || "N/A";
        let display_guest_name = r_info.guest_name || "In-House Guest";
        let display_phone = r_info.guest_phone || "N/A";
        let display_stay = stay || r_info.stay_name || r_info.stay || "N/A";
        let display_room_type = r_info.room_type || "Standard Room";
        let display_floor = r_info.floor || "G";
        let display_cin = r_info.checkin_date || "N/A";
        let display_cout = r_info.expected_checkout || "N/A";
        let display_status = r_info.departure_status || "Active";
        let display_charges = flt(r_info.total_charges || 0);
        let display_paid = flt(r_info.total_paid || 0);
        let display_balance = flt(r_info.folio_balance !== undefined ? r_info.folio_balance : (r_info.balance_due !== undefined ? r_info.balance_due : (display_charges - display_paid)));

        let currency = frappe.defaults.get_default("currency") || "₹";

        let d = new frappe.ui.Dialog({
            title: __("Room {0} · In-House Guest", [display_room_no]),
            fields: [
                {
                    fieldtype: "HTML",
                    options: `
                        <div class="inhouse-modal-header" style="background: linear-gradient(135deg, #0f172a, #1e293b); color: #ffffff !important; padding: 18px 20px; border-radius: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 4px 14px rgba(15,23,42,0.18);">
                            <div class="inhouse-header-guest">
                                <h3 style="color: #ffffff !important; font-size: 19px; font-weight: 800; margin: 0; display: flex; align-items: center; gap: 8px;">
                                    <span style="font-size: 22px;">👤</span> ${frappe.utils.escape_html(display_guest_name)}
                                </h3>
                                <p style="color: #cbd5e1 !important; font-size: 13px; margin: 6px 0 0 0; font-weight: 500;">
                                    📱 ${frappe.utils.escape_html(display_phone)} · Stay #${frappe.utils.escape_html(display_stay)}
                                </p>
                            </div>
                            <div style="text-align: right; color: #ffffff !important;">
                                <div style="font-size: 22px; font-weight: 800; color: #38bdf8 !important; letter-spacing: -0.5px;">Room ${frappe.utils.escape_html(display_room_no)}</div>
                                <div style="font-size: 12.5px; color: #cbd5e1 !important; font-weight: 500; margin-top: 3px;">${frappe.utils.escape_html(display_room_type)} (Floor ${frappe.utils.escape_html(display_floor)})</div>
                            </div>
                        </div>

                        <div class="financial-summary-card">
                            <div class="financial-row">
                                <span class="text-muted">${__("Check-In Date")}:</span>
                                <strong>${display_cin}</strong>
                            </div>
                            <div class="financial-row">
                                <span class="text-muted">${__("Expected Checkout")}:</span>
                                <strong>${display_cout} (${display_status})</strong>
                            </div>
                            <div class="financial-row" style="margin-top: 6px;">
                                <span class="text-muted">${__("Total Billed Charges")}:</span>
                                <span>${format_currency(display_charges, currency)}</span>
                            </div>
                            <div class="financial-row">
                                <span class="text-muted">${__("Total Paid / Advance")}:</span>
                                <span class="text-success font-bold">${format_currency(display_paid, currency)}</span>
                            </div>
                            <div class="financial-balance-banner">
                                <span>${__("Net Outstanding Due")}:</span>
                                <span class="${display_balance > 0 ? 'text-danger' : 'text-success'}">
                                    ${format_currency(display_balance, currency)}
                                </span>
                            </div>
                        </div>

                        <div class="modal-actions-grid">
                            <div class="modal-act-btn act-charge" id="btn-modal-add-charge">
                                <span style="font-size: 18px;">➕</span>
                                <span>${__("Add Charge")}</span>
                            </div>
                            <div class="modal-act-btn act-payment" id="btn-modal-collect-pay">
                                <span style="font-size: 18px;">💵</span>
                                <span>${__("Collect Payment")}</span>
                            </div>
                            <div class="modal-act-btn act-cleaning" id="btn-modal-request-clean">
                                <span style="font-size: 18px;">🧹</span>
                                <span>${__("Request Cleaning")}</span>
                            </div>
                            <div class="modal-act-btn act-transfer" id="btn-modal-move-room">
                                <span style="font-size: 18px;">🔄</span>
                                <span>${__("Change Room")}</span>
                            </div>
                            <div class="modal-act-btn act-checkout" id="btn-modal-checkout">
                                <span style="font-size: 18px;">🚪</span>
                                <span>${__("Checkout")}</span>
                            </div>
                        </div>
                    `
                }
            ]
        });

        d.show();

        // Bind In-House Modal Actions
        d.$wrapper.on("click", "#btn-modal-add-charge", () => {
            d.hide();
            this.open_add_charge_dialog(display_stay, display_room_no);
        });

        d.$wrapper.on("click", "#btn-modal-collect-pay", () => {
            d.hide();
            this.open_collect_payment_dialog(display_stay, display_room_no, display_balance);
        });

        d.$wrapper.on("click", "#btn-modal-request-clean", () => {
            d.hide();
            this.request_cleaning(display_room_no, display_stay);
        });

        d.$wrapper.on("click", "#btn-modal-move-room", () => {
            d.hide();
            this.open_room_change_dialog(display_stay, display_room_no);
        });

        d.$wrapper.on("click", "#btn-modal-checkout", () => {
            d.hide();
            this.open_checkout_dialog(display_stay, display_room_no, display_balance);
        });
    }

    // ----------------------------------------------------------------------
    // Modal: Add Extra Service Charge (Food, Laundry, etc.)
    // ----------------------------------------------------------------------
    open_add_charge_dialog(stay, room) {
        room = String(room || "").trim();
        stay = String(stay || "").trim();

        let r_info = (this.data.rooms || []).find(x =>
            String(x.room).trim() === room ||
            String(x.room_number).trim() === room ||
            (stay && String(x.stay_name).trim() === stay)
        ) || {};

        let inhouse_info = (this.data.inhouse || []).find(x =>
            (stay && String(x.stay).trim() === stay) ||
            String(x.room).trim() === room
        );

        stay = stay || r_info.stay_name || (inhouse_info ? inhouse_info.stay : "");
        let display_room = r_info.room_number || room || (inhouse_info ? inhouse_info.room_number : "");

        let charge_types = (this.data.masters && this.data.masters.charge_types) || [
            "Restaurant / F&B", "Laundry", "Room Service", "Minibar", "Extra Bed", "Other"
        ];

        let d = new frappe.ui.Dialog({
            title: __("➕ Add Extra Charge · Room {0}", [display_room]),
            fields: [
                {
                    label: __("Charge Type"),
                    fieldname: "charge_type",
                    fieldtype: "Select",
                    options: charge_types,
                    default: "Restaurant / F&B",
                    reqd: 1
                },
                {
                    label: __("Amount (₹)"),
                    fieldname: "amount",
                    fieldtype: "Currency",
                    reqd: 1
                },
                { fieldtype: "Column Break" },
                {
                    label: __("Quantity"),
                    fieldname: "qty",
                    fieldtype: "Float",
                    default: 1,
                    reqd: 1
                },
                {
                    label: __("Description"),
                    fieldname: "description",
                    fieldtype: "Data",
                    placeholder: "e.g. Dinner Buffet / 2 Shirts Laundry"
                }
            ],
            primary_action_label: __("Post Charge to Folio"),
            primary_action: (vals) => {
                if (flt(vals.amount) <= 0) {
                    frappe.msgprint(__("Charge Amount must be greater than zero."));
                    return false;
                }
                if (flt(vals.qty) <= 0) {
                    frappe.msgprint(__("Quantity must be at least 1."));
                    return false;
                }

                vals.stay = stay;
                frappe.call({
                    method: "hotel_pms.hotel_pms.page.hotel_dashboard.hotel_dashboard.add_folio_charge",
                    args: vals,
                    freeze: true,
                    callback: (r) => {
                        if (r.message && r.message.status === "success") {
                            d.hide();
                            frappe.show_alert({
                                message: __("Charge added! New Folio Balance: {0}", [format_currency(r.message.balance_due)]),
                                indicator: "green"
                            });
                            this.load_data();
                        }
                    }
                });
            }
        });
        d.show();
    }

    // ----------------------------------------------------------------------
    // Modal: Collect Payment
    // ----------------------------------------------------------------------
    open_collect_payment_dialog(stay, room, current_balance) {
        room = String(room || "").trim();
        stay = String(stay || "").trim();

        let r_info = (this.data.rooms || []).find(x =>
            String(x.room).trim() === room ||
            String(x.room_number).trim() === room ||
            (stay && String(x.stay_name).trim() === stay)
        ) || {};

        let inhouse_info = (this.data.inhouse || []).find(x =>
            (stay && String(x.stay).trim() === stay) ||
            String(x.room).trim() === room
        );

        stay = stay || r_info.stay_name || (inhouse_info ? inhouse_info.stay : "");
        let display_room = r_info.room_number || room || (inhouse_info ? inhouse_info.room_number : "");
        let bal = current_balance !== undefined ? current_balance : (r_info.folio_balance !== undefined ? r_info.folio_balance : (inhouse_info ? inhouse_info.balance_due : 0));
        bal = flt(bal);

        let payment_modes = (this.data.masters && this.data.masters.payment_modes) || ["Cash", "Bank", "UPI", "Credit Card"];

        let d = new frappe.ui.Dialog({
            title: __("💵 Collect Guest Payment · Room {0}", [display_room]),
            fields: [
                {
                    label: __("Payment Amount (₹)"),
                    fieldname: "amount",
                    fieldtype: "Currency",
                    default: bal > 0 ? bal : 0,
                    reqd: 1
                },
                {
                    label: __("Payment Mode"),
                    fieldname: "mode_of_payment",
                    fieldtype: "Select",
                    options: payment_modes,
                    default: payment_modes[0],
                    reqd: 1
                },
                { fieldtype: "Column Break" },
                {
                    label: __("Reference / Transaction ID"),
                    fieldname: "reference_no",
                    fieldtype: "Data",
                    placeholder: "e.g. UPI Ref / Card Last 4 digits"
                }
            ],
            primary_action_label: __("Record Payment Entry"),
            primary_action: (vals) => {
                if (flt(vals.amount) <= 0) {
                    frappe.msgprint(__("Payment Amount must be greater than zero."));
                    return false;
                }
                if (!vals.mode_of_payment) {
                    frappe.msgprint(__("Please select a Mode of Payment."));
                    return false;
                }

                vals.stay = stay;
                frappe.call({
                    method: "hotel_pms.hotel_pms.page.hotel_dashboard.hotel_dashboard.collect_stay_payment",
                    args: vals,
                    freeze: true,
                    freeze_message: __("Recording payment & updating folio..."),
                    callback: (r) => {
                        if (r.message && r.message.status === "success") {
                            d.hide();
                            frappe.show_alert({
                                message: __("Payment of {0} recorded! Remaining Due: {1}", [format_currency(r.message.amount_paid), format_currency(r.message.balance_due)]),
                                indicator: "green"
                            });
                            this.load_data();
                        }
                    }
                });
            }
        });
        d.show();
    }

    // ----------------------------------------------------------------------
    // Modal: Advance Reservation (Future Dates)
    // ----------------------------------------------------------------------
    open_new_reservation_dialog() {
        let room_types = (this.data.masters && this.data.masters.room_types) || [];
        let rt_options = room_types.map(x => x.name);
        let payment_modes = (this.data.masters && this.data.masters.payment_modes) || ["Cash", "Bank", "UPI"];

        let d = new frappe.ui.Dialog({
            title: __("📅 New Advance Reservation"),
            fields: [
                {
                    label: __("Guest Name"),
                    fieldname: "guest_name",
                    fieldtype: "Data",
                    reqd: 1,
                    placeholder: "e.g. Alice Smith"
                },
                {
                    label: __("Phone Number"),
                    fieldname: "phone",
                    fieldtype: "Data",
                    reqd: 1,
                    placeholder: "e.g. 9123456789"
                },
                { fieldtype: "Column Break" },
                {
                    label: __("Email"),
                    fieldname: "email",
                    fieldtype: "Data",
                    placeholder: "alice@example.com"
                },
                {
                    label: __("Room Type"),
                    fieldname: "room_type",
                    fieldtype: "Select",
                    options: rt_options,
                    default: rt_options[0],
                    reqd: 1,
                    onchange: () => {
                        let rtVal = d.get_value("room_type");
                        let rtObj = room_types.find(x => x.name === rtVal);
                        if (rtObj) d.set_value("room_rate", rtObj.base_rate);
                    }
                },
                { fieldtype: "Section Break", label: __("Stay Dates & Pricing") },
                {
                    label: __("Arrival Date"),
                    fieldname: "arrival_date",
                    fieldtype: "Date",
                    default: frappe.datetime.add_days(frappe.datetime.get_today(), 1),
                    reqd: 1
                },
                {
                    label: __("Departure Date"),
                    fieldname: "departure_date",
                    fieldtype: "Date",
                    default: frappe.datetime.add_days(frappe.datetime.get_today(), 3),
                    reqd: 1
                },
                { fieldtype: "Column Break" },
                {
                    label: __("Rate Per Night (₹)"),
                    fieldname: "room_rate",
                    fieldtype: "Currency",
                    default: room_types[0] ? room_types[0].base_rate : 3500,
                    reqd: 1
                },
                {
                    label: __("Assign Room (Optional)"),
                    fieldname: "assigned_room",
                    fieldtype: "Link",
                    options: "Hotel Room"
                },
                { fieldtype: "Section Break", label: __("Advance Deposit (Optional)") },
                {
                    label: __("Advance Deposit (₹)"),
                    fieldname: "advance_amount",
                    fieldtype: "Currency",
                    default: 0
                },
                {
                    label: __("Payment Mode"),
                    fieldname: "mode_of_payment",
                    fieldtype: "Select",
                    options: payment_modes,
                    default: payment_modes[0]
                }
            ],
            primary_action_label: __("Confirm Booking"),
            primary_action: (vals) => {
                // Validation: Guest Name
                let gName = (vals.guest_name || "").trim();
                if (!gName || gName.length < 2) {
                    frappe.msgprint(__("Please enter a valid Guest Full Name (minimum 2 characters)."));
                    return false;
                }

                // Validation: Mobile Number (10-15 digits)
                let rawPhone = (vals.phone || "").trim();
                let cleanPhone = rawPhone.replace(/\D/g, "");
                if (!rawPhone || cleanPhone.length < 10 || cleanPhone.length > 15) {
                    frappe.msgprint(__("Please enter a valid Mobile Number (10 to 15 digits)."));
                    return false;
                }

                // Validation: Email (if entered)
                if (vals.email && vals.email.trim()) {
                    let emailTrim = vals.email.trim();
                    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
                        frappe.msgprint(__("Please enter a valid Email Address."));
                        return false;
                    }
                }

                // Validation: Dates
                let todayDate = frappe.datetime.get_today();
                if (vals.arrival_date < todayDate) {
                    frappe.msgprint(__("Arrival Date cannot be in the past."));
                    return false;
                }
                if (vals.departure_date <= vals.arrival_date) {
                    frappe.msgprint(__("Departure Date must be strictly after Arrival Date."));
                    return false;
                }

                // Validation: Room Rate & Advance
                if (flt(vals.room_rate) <= 0) {
                    frappe.msgprint(__("Rate Per Night must be greater than zero."));
                    return false;
                }
                if (flt(vals.advance_amount) < 0) {
                    frappe.msgprint(__("Advance Deposit cannot be negative."));
                    return false;
                }

                frappe.call({
                    method: "hotel_pms.hotel_pms.page.hotel_dashboard.hotel_dashboard.quick_create_reservation",
                    args: vals,
                    freeze: true,
                    freeze_message: __("Creating reservation..."),
                    callback: (r) => {
                        if (r.message && r.message.status === "success") {
                            d.hide();
                            frappe.show_alert({
                                message: __("Reservation #{0} confirmed for {1}!", [r.message.reservation, r.message.guest]),
                                indicator: "green"
                            });
                            this.load_data();
                        }
                    }
                });
            }
        });
        d.show();
    }

    // ----------------------------------------------------------------------
    // Modal: 1-Click Checkout with Auto-Settlement
    // ----------------------------------------------------------------------
    open_checkout_dialog(stay, room, balance) {
        room = String(room || "").trim();
        stay = String(stay || "").trim();

        let r_info = (this.data.rooms || []).find(x =>
            String(x.room).trim() === room ||
            String(x.room_number).trim() === room ||
            (stay && String(x.stay_name).trim() === stay)
        ) || {};

        let inhouse_info = (this.data.inhouse || []).find(x =>
            (stay && String(x.stay).trim() === stay) ||
            String(x.room).trim() === room
        );

        stay = stay || r_info.stay_name || (inhouse_info ? inhouse_info.stay : "");
        let display_room = r_info.room_number || room || (inhouse_info ? inhouse_info.room_number : "");
        let rem_balance = balance !== undefined ? balance : (r_info.folio_balance !== undefined ? r_info.folio_balance : (inhouse_info ? inhouse_info.balance_due : 0));
        rem_balance = flt(rem_balance);

        let payment_modes = (this.data.masters && this.data.masters.payment_modes) || ["Cash", "Bank", "UPI", "Credit Card"];

        if (rem_balance <= 0) {
            frappe.confirm(__("Folio is settled. Proceed to check out Stay #{0} for Room {1}?", [stay, display_room]), () => {
                frappe.call({
                    method: "hotel_pms.hotel_pms.page.hotel_dashboard.hotel_dashboard.instant_checkout",
                    args: { stay: stay },
                    freeze: true,
                    freeze_message: __("Processing checkout & generating Sales Invoice..."),
                    callback: (r) => {
                        frappe.show_alert({
                            message: __("Room {0} checked out! Sales Invoice created.", [display_room]),
                            indicator: "green"
                        });
                        this.load_data();
                    }
                });
            });
        } else {
            // Balance remains: offer 1-click settlement & checkout
            let d = new frappe.ui.Dialog({
                title: __("🚪 Checkout & Settle Due Balance · Room {0}", [display_room]),
                fields: [
                    {
                        fieldtype: "HTML",
                        options: `
                            <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px 14px; margin-bottom: 14px; color: #991b1b;">
                                <strong>Pending Balance: ${format_currency(rem_balance)}</strong>
                                <div style="font-size: 12px; margin-top: 3px;">Select a payment mode to collect this amount and complete checkout in one step.</div>
                            </div>
                        `
                    },
                    {
                        label: __("Settlement Amount (₹)"),
                        fieldname: "settle_balance",
                        fieldtype: "Currency",
                        default: rem_balance,
                        read_only: 1
                    },
                    {
                        label: __("Mode of Payment"),
                        fieldname: "mode_of_payment",
                        fieldtype: "Select",
                        options: payment_modes,
                        default: payment_modes[0],
                        reqd: 1
                    }
                ],
                primary_action_label: __("Settle & Complete Checkout"),
                primary_action: (vals) => {
                    if (flt(vals.settle_balance) > 0 && !vals.mode_of_payment) {
                        frappe.msgprint(__("Please select a Mode of Payment to settle the balance."));
                        return false;
                    }

                    frappe.call({
                        method: "hotel_pms.hotel_pms.page.hotel_dashboard.hotel_dashboard.instant_checkout",
                        args: {
                            stay: stay,
                            settle_balance: vals.settle_balance,
                            mode_of_payment: vals.mode_of_payment
                        },
                        freeze: true,
                        freeze_message: __("Recording payment & generating final invoice..."),
                        callback: (r) => {
                            d.hide();
                            frappe.show_alert({
                                message: __("Checkout completed! Invoice generated & Room {0} marked for cleaning.", [display_room]),
                                indicator: "green"
                            });
                            this.load_data();
                        }
                    });
                }
            });
            d.show();
        }
    }

    // ----------------------------------------------------------------------
    // Modal: Mid-Stay Room Move
    // ----------------------------------------------------------------------
    open_room_change_dialog(stay, current_room) {
        current_room = String(current_room || "").trim();
        stay = String(stay || "").trim();

        let r_info = (this.data.rooms || []).find(x =>
            String(x.room).trim() === current_room ||
            String(x.room_number).trim() === current_room ||
            (stay && String(x.stay_name).trim() === stay)
        ) || {};

        let inhouse_info = (this.data.inhouse || []).find(x =>
            (stay && String(x.stay).trim() === stay) ||
            String(x.room).trim() === current_room
        );

        stay = stay || r_info.stay_name || (inhouse_info ? inhouse_info.stay : "");
        let display_room = r_info.room_number || current_room || (inhouse_info ? inhouse_info.room_number : "");

        let clean_rooms = (this.data.masters && this.data.masters.clean_rooms) || [];
        let room_options = clean_rooms.filter(x => String(x.room) !== String(current_room) && String(x.room_number) !== String(display_room)).map(x => ({ label: `Room ${x.room_number} (${x.room_type})`, value: x.room }));

        let d = new frappe.ui.Dialog({
            title: __("🔄 Move Guest from Room {0}", [display_room]),
            fields: [
                {
                    label: __("Target Clean Room"),
                    fieldname: "new_room",
                    fieldtype: "Select",
                    options: room_options,
                    reqd: 1
                },
                {
                    label: __("Reason for Room Change"),
                    fieldname: "reason",
                    fieldtype: "Small Text",
                    default: "Guest Request",
                    reqd: 1
                }
            ],
            primary_action_label: __("Confirm Room Transfer"),
            primary_action: (vals) => {
                if (!vals.new_room) {
                    frappe.msgprint(__("Please select a target clean room."));
                    return false;
                }
                if (!vals.reason || !vals.reason.trim()) {
                    frappe.msgprint(__("Please provide a reason for the room transfer."));
                    return false;
                }

                frappe.call({
                    method: "hotel_pms.hotel_pms.doctype.hotel_stay.hotel_stay.move_room",
                    args: {
                        stay: stay,
                        new_room: vals.new_room,
                        reason: vals.reason
                    },
                    freeze: true,
                    callback: (r) => {
                        d.hide();
                        frappe.show_alert({
                            message: __("Guest transferred to Room {0}!", [vals.new_room]),
                            indicator: "green"
                        });
                        this.load_data();
                    }
                });
            }
        });
        d.show();
    }

    // ----------------------------------------------------------------------
    // Request Daily Cleaning
    // ----------------------------------------------------------------------
    request_cleaning(room, stay) {
        room = String(room || "").trim();
        stay = String(stay || "").trim();

        let r_info = (this.data.rooms || []).find(x =>
            String(x.room).trim() === room ||
            String(x.room_number).trim() === room
        ) || {};
        let target_room = r_info.room || room;

        frappe.call({
            method: "hotel_pms.hotel_pms.page.hotel_dashboard.hotel_dashboard.request_daily_cleaning",
            args: { room: target_room, stay: stay },
            freeze: true,
            callback: (r) => {
                if (r.message && r.message.status === "success") {
                    frappe.show_alert({
                        message: __("Daily cleaning scheduled for Room {0}!", [room]),
                        indicator: "green"
                    });
                    this.load_data();
                } else if (r.message && r.message.message) {
                    frappe.msgprint(r.message.message);
                }
            }
        });
    }

    // ----------------------------------------------------------------------
    // Mark Clean Helper
    // ----------------------------------------------------------------------
    mark_clean(room) {
        room = String(room || "").trim();

        let r_info = (this.data.rooms || []).find(x =>
            String(x.room).trim() === room ||
            String(x.room_number).trim() === room
        ) || {};
        let target_room = r_info.room || room;

        frappe.call({
            method: "hotel_pms.hotel_pms.page.hotel_dashboard.hotel_dashboard.mark_room_clean",
            args: { room: target_room },
            freeze: true,
            callback: (r) => {
                frappe.show_alert({
                    message: __("Room {0} marked clean and ready for guests!", [room]),
                    indicator: "green"
                });
                this.load_data();
            }
        });
    }

    // ----------------------------------------------------------------------
    // Render Operations Tabs: Arrivals, Departures, In-House, Housekeeping
    // ----------------------------------------------------------------------
    render_arrivals() {
        let arrivals = this.data.arrivals || [];
        let currency = frappe.defaults.get_default("currency") || "₹";

        if (arrivals.length === 0) {
            this.$wrapper.find("#pane-arrivals").html(`<div class="text-muted p-4 text-center">${__("No expected arrivals.")}</div>`);
            return;
        }

        let html = `
            <div class="dash-table-wrapper">
                <table class="hotel-table">
                    <thead>
                        <tr>
                            <th>${__("Guest Name")}</th>
                            <th>${__("Dates")}</th>
                            <th>${__("Room Type")}</th>
                            <th>${__("Assigned Room")}</th>
                            <th>${__("Advance Paid")}</th>
                            <th>${__("Actions")}</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        arrivals.forEach(a => {
            html += `
                <tr>
                    <td>
                        <strong>${frappe.utils.escape_html(a.guest_name)}</strong>
                        <div class="text-muted" style="font-size: 11px;">📱 ${a.contact_phone || 'N/A'} · #${a.name}</div>
                    </td>
                    <td>
                        ${a.arrival_date} ➔ ${a.departure_date}
                        <div class="text-muted" style="font-size: 11px;">${a.nights} Night(s)</div>
                    </td>
                    <td>${a.room_type}</td>
                    <td>
                        ${a.assigned_room ? `<strong style="font-size:14px;">Room ${a.assigned_room}</strong>` : `<span class="text-warning font-bold">Unassigned</span>`}
                    </td>
                    <td>
                        ${a.advance_paid > 0 ?
                    `<span class="table-badge badge-clean">Paid ${format_currency(a.advance_paid, currency)}</span>` :
                    `<span class="table-badge badge-dirty">Unpaid</span>`
                }
                    </td>
                    <td>
                        <button class="btn btn-xs btn-primary btn-checkin-arrival" data-res="${a.name}" data-room="${a.assigned_room || ''}">
                            ⚡ ${__("Check-In Now")}
                        </button>
                    </td>
                </tr>
            `;
        });

        html += `</tbody></table></div>`;
        this.$wrapper.find("#pane-arrivals").html(html);

        // Bind Check-In button on arrival row
        this.$wrapper.find(".btn-checkin-arrival").on("click", (e) => {
            let res = $(e.currentTarget).data("res");
            let room = $(e.currentTarget).data("room");

            if (room) {
                frappe.confirm(__("Check in reservation #{0} for Room {1}?", [res, room]), () => {
                    this.execute_arrival_checkin(res, room);
                });
            } else {
                // Let staff pick a clean room
                let clean_rooms = (this.data.masters && this.data.masters.clean_rooms) || [];
                let room_options = clean_rooms.map(x => ({ label: `Room ${x.room_number} (${x.room_type})`, value: x.room }));

                let d = new frappe.ui.Dialog({
                    title: __("Assign Room for Check-In"),
                    fields: [
                        {
                            label: __("Select Clean Room"),
                            fieldname: "room",
                            fieldtype: "Select",
                            options: room_options,
                            reqd: 1
                        }
                    ],
                    primary_action_label: __("Confirm Check-In"),
                    primary_action: (vals) => {
                        d.hide();
                        this.execute_arrival_checkin(res, vals.room);
                    }
                });
                d.show();
            }
        });
    }

    execute_arrival_checkin(res, room) {
        frappe.call({
            method: "hotel_pms.hotel_pms.page.hotel_dashboard.hotel_dashboard.checkin_reservation",
            args: { reservation: res, room: room },
            freeze: true,
            callback: (r) => {
                frappe.show_alert({
                    message: __("Checked in successfully! Room {0} is now Occupied.", [room]),
                    indicator: "green"
                });
                this.load_data();
            }
        });
    }

    render_departures() {
        let departures = this.data.departures || [];
        let currency = frappe.defaults.get_default("currency") || "₹";

        if (departures.length === 0) {
            this.$wrapper.find("#pane-departures").html(`<div class="text-muted p-4 text-center">${__("No departures scheduled for today.")}</div>`);
            return;
        }

        let html = `
            <div class="dash-table-wrapper">
                <table class="hotel-table">
                    <thead>
                        <tr>
                            <th>${__("Room")}</th>
                            <th>${__("Guest Name")}</th>
                            <th>${__("Stay Period")}</th>
                            <th>${__("Balance Due")}</th>
                            <th>${__("Action")}</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        departures.forEach(d => {
            html += `
                <tr>
                    <td><strong style="font-size: 15px;">Room ${d.room}</strong></td>
                    <td>
                        <strong>${frappe.utils.escape_html(d.guest_name)}</strong>
                        <div class="text-muted" style="font-size: 11px;">📱 ${d.guest_phone || 'N/A'}</div>
                    </td>
                    <td>
                        ${d.checkin_date} ➔ ${d.expected_checkout}
                        <div class="text-danger" style="font-size: 11px; font-weight:700;">${d.departure_status || 'Due'}</div>
                    </td>
                    <td>
                        ${d.balance_due > 0 ?
                    `<span class="table-badge badge-dirty font-bold">Due ${format_currency(d.balance_due, currency)}</span>` :
                    `<span class="table-badge badge-clean">✓ Paid</span>`
                }
                    </td>
                    <td>
                        <button class="btn btn-xs btn-default btn-departure-checkout" data-stay="${d.stay}" data-room="${d.room}" data-balance="${d.balance_due}">
                            🚪 ${__("Checkout")}
                        </button>
                    </td>
                </tr>
            `;
        });

        html += `</tbody></table></div>`;
        this.$wrapper.find("#pane-departures").html(html);

        this.$wrapper.find(".btn-departure-checkout").on("click", (e) => {
            let stay = String($(e.currentTarget).attr("data-stay") || "").trim();
            let room = String($(e.currentTarget).attr("data-room") || "").trim();
            let bal = flt($(e.currentTarget).attr("data-balance"));
            this.open_checkout_dialog(stay, room, bal);
        });
    }

    render_inhouse() {
        let inhouse = this.data.inhouse || [];
        let currency = frappe.defaults.get_default("currency") || "₹";

        if (inhouse.length === 0) {
            this.$wrapper.find("#pane-inhouse").html(`<div class="text-muted p-4 text-center">${__("No in-house guests currently.")}</div>`);
            return;
        }

        let html = `
            <div class="dash-table-wrapper">
                <table class="hotel-table">
                    <thead>
                        <tr>
                            <th>${__("Room")}</th>
                            <th>${__("Guest Name")}</th>
                            <th>${__("Dates")}</th>
                            <th>${__("Charges")}</th>
                            <th>${__("Paid")}</th>
                            <th>${__("Balance Due")}</th>
                            <th>${__("Actions")}</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        inhouse.forEach(g => {
            html += `
                <tr>
                    <td><strong style="font-size: 15px;">Room ${g.room}</strong> <div class="text-muted" style="font-size:11px;">${g.room_type}</div></td>
                    <td>
                        <strong>${frappe.utils.escape_html(g.guest_name)}</strong>
                        <div class="text-muted" style="font-size: 11px;">📱 ${g.guest_phone || 'N/A'} · #${g.stay}</div>
                    </td>
                    <td>
                        ${g.checkin_date} ➔ ${g.expected_checkout}
                        <div class="text-muted" style="font-size: 11px;">${g.total_nights} Nights (${g.departure_status || ''})</div>
                    </td>
                    <td>${format_currency(g.total_charges, currency)}</td>
                    <td class="text-success font-bold">${format_currency(g.total_paid, currency)}</td>
                    <td>
                        ${g.balance_due > 0 ?
                    `<span class="table-badge badge-dirty font-bold">Due ${format_currency(g.balance_due, currency)}</span>` :
                    `<span class="table-badge badge-clean">✓ Paid</span>`
                }
                    </td>
                    <td>
                        <button class="btn btn-xs btn-default btn-row-charge" data-stay="${g.stay}" data-room="${g.room}">➕ ${__("Charge")}</button>
                        <button class="btn btn-xs btn-default btn-row-pay" data-stay="${g.stay}" data-room="${g.room}" data-balance="${g.balance_due}">💵 ${__("Pay")}</button>
                        <button class="btn btn-xs btn-danger btn-row-checkout" data-stay="${g.stay}" data-room="${g.room}" data-balance="${g.balance_due}">🚪 ${__("Out")}</button>
                    </td>
                </tr>
            `;
        });

        html += `</tbody></table></div>`;
        this.$wrapper.find("#pane-inhouse").html(html);

        this.$wrapper.find(".btn-row-charge").on("click", (e) => {
            let stay = String($(e.currentTarget).attr("data-stay") || "").trim();
            let room = String($(e.currentTarget).attr("data-room") || "").trim();
            this.open_add_charge_dialog(stay, room);
        });

        this.$wrapper.find(".btn-row-pay").on("click", (e) => {
            let stay = String($(e.currentTarget).attr("data-stay") || "").trim();
            let room = String($(e.currentTarget).attr("data-room") || "").trim();
            let bal = flt($(e.currentTarget).attr("data-balance"));
            this.open_collect_payment_dialog(stay, room, bal);
        });

        this.$wrapper.find(".btn-row-checkout").on("click", (e) => {
            let stay = String($(e.currentTarget).attr("data-stay") || "").trim();
            let room = String($(e.currentTarget).attr("data-room") || "").trim();
            let bal = flt($(e.currentTarget).attr("data-balance"));
            this.open_checkout_dialog(stay, room, bal);
        });
    }

    render_housekeeping() {
        let tasks = this.data.housekeeping || [];

        if (tasks.length === 0) {
            this.$wrapper.find("#pane-housekeeping").html(`<div class="text-muted p-4 text-center">✨ ${__("All rooms are clean! No pending housekeeping tasks.")}</div>`);
            return;
        }

        let html = `
            <div class="dash-table-wrapper">
                <table class="hotel-table">
                    <thead>
                        <tr>
                            <th>${__("Room")}</th>
                            <th>${__("Task Type")}</th>
                            <th>${__("Priority")}</th>
                            <th>${__("Assigned Date")}</th>
                            <th>${__("Notes")}</th>
                            <th>${__("Action")}</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        tasks.forEach(t => {
            let pColor = t.priority === "Urgent" || t.priority === "High" ? "badge-dirty" : "badge-clean";
            html += `
                <tr>
                    <td><strong style="font-size: 15px;">Room ${t.room}</strong></td>
                    <td><strong>${t.task_type}</strong></td>
                    <td><span class="table-badge ${pColor}">${t.priority}</span></td>
                    <td>${t.assigned_date}</td>
                    <td class="text-muted">${frappe.utils.escape_html(t.notes || 'N/A')}</td>
                    <td>
                        <button class="btn btn-xs btn-success btn-hk-clean" data-room="${t.room}">
                            ✓ ${__("Mark Clean")}
                        </button>
                    </td>
                </tr>
            `;
        });

        html += `</tbody></table></div>`;
        this.$wrapper.find("#pane-housekeeping").html(html);

        this.$wrapper.find(".btn-hk-clean").on("click", (e) => {
            let room = $(e.currentTarget).data("room");
            this.mark_clean(room);
        });
    }
}
