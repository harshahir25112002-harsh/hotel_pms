# Hotel PMS for ERPNext / Frappe v16

Comprehensive Hotel Property Management System (PMS) natively integrated with ERPNext v16 accounting, stock, and front-desk operations.

## Architecture & Features

### 1. Masters
- **Hotel Room Type**: Base rates, adult/child occupancy limits, amenities.
- **Hotel Room**: Room number, floor, room type, status (Vacant Clean, Vacant Dirty, Occupied, Out of Order), Minibar warehouse link, Asset link.
- **Hotel Rate Plan**: Seasonal pricing, meal plans (EP, CP, MAP, AP).
- **Hotel Service Item**: Laundry, Minibar, F&B services linked to ERPNext Items.
- **Hotel Settings**: Company defaults, Income Account, Cost Center, Warehouse, Tax Template, Check-in/Check-out default times.

### 2. Operations & Transactions
- **Hotel Reservation**: Submittable booking with room availability checks, arrival/departure dates, and advance tracking via `Payment Entry`.
- **Hotel Stay**: Check-in record with guest KYC (ID proof, Passport, C-Form), room locking, and 1-click checkout.
- **Hotel Room Movement**: Mid-stay room transfers with automatic status updating, rate adjustments, and housekeeping task generation for the old room.
- **Guest Folio & Folio Charge**: Central billing engine with automatic GST slab calculation, split/corporate billing, advance allocation, live outstanding balance, and 1-click **Sales Invoice** generation.
- **Housekeeping Task**: Cleaning assignments, priority tracking, and 1-click completion setting rooms back to *Vacant Clean*.
- **Night Audit**: Automated daily charge posting at 02:00 AM, room revenue reconciliation, and ADR/RevPAR calculation.

### 3. Front Desk & Room Rack Dashboard
Access via Frappe Desk: **Hotel Front Desk & Room Rack** (`/app/hotel_dashboard`)
- **Top KPI Cards**: Live Occupancy %, Vacant Clean, Vacant Dirty, Occupied, Today's Revenue, Unpaid Folios, ADR & RevPAR.
- **Live Room Rack Grid**: Color-coded visual status cards with quick actions (1-click "Mark Clean", "View Folio", "Check-In").
- **Operations Feeds**: Tabular lists for Today's Arrivals, Expected Departures, and Housekeeping Queue with instant actions.

## Installation & Setup

```bash
# In your bench environment:
bench get-app /path/to/hotel_pms # Or symlink F:/hotel_pms into your apps directory
bench --site yoursite install-app hotel_pms
bench --site yoursite migrate
bench build --app hotel_pms
bench restart
```

