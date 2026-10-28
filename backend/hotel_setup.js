use("hotel_mongodb");

// ==========================================
// HOTEL MANAGEMENT SYSTEM - MONGODB DATABASE
// ==========================================

// 1. CREATE COLLECTIONS
const collectionNames = [
  "restaurant_orders",
  "guest_reviews",
  "audit_logs",
  "folio_details",
  "housekeeping_checklists"
];

for (const name of collectionNames) {
  if (!db.getCollectionNames().includes(name)) {
    db.createCollection(name);
  }
}

print("All five collections are ready!");

// ==========================================
// 2. RESTAURANT ORDERS
// ==========================================

db.restaurant_orders.updateOne(
  { order_id: "ORD-9001" },
  {
    $set: {
      order_id: "ORD-9001",
      booking_id: "B-1081",
      guest_id: "G-101",
      room_number: "201",
      order_date: new Date(),
      items: [
        {
          food_id: "FD-01",
          item_name: "Paneer Butter Masala",
          quantity: 2,
          unit_price: 320
        },
        {
          food_id: "FD-09",
          item_name: "Butter Naan",
          quantity: 4,
          unit_price: 45
        }
      ],
      subtotal: 820,
      tax_cgst: 41,
      tax_sgst: 41,
      total_amount: 902,
      billing_folio_applied: true,
      delivery_status: "Delivered"
    }
  },
  { upsert: true }
);

// ==========================================
// 3. GUEST REVIEWS
// ==========================================

db.guest_reviews.updateOne(
  { review_id: "REV-501" },
  {
    $set: {
      review_id: "REV-501",
      booking_id: "B-1081",
      guest_id: "G-101",
      guest_name: "Aarav Sharma",
      rating: 5,
      categories: {
        cleanliness: 5,
        staff_courtesy: 5,
        room_comfort: 4,
        food_quality: 5
      },
      comments: "Excellent hospitality and fast check-in.",
      created_at: new Date()
    }
  },
  { upsert: true }
);

// ==========================================
// 4. AUDIT LOGS
// ==========================================

db.audit_logs.updateOne(
  { log_id: "LOG-1001" },
  {
    $set: {
      log_id: "LOG-1001",
      timestamp: new Date(),
      actor: "front_desk_receptionist",
      action: "ROOM_CHECK_IN",
      target_id: "B-1081",
      details: {
        room_no: "201",
        check_in_time: new Date()
      },
      ip_address: "192.168.1.10"
    }
  },
  { upsert: true }
);

// ==========================================
// 5. FOLIO DETAILS
// ==========================================

db.folio_details.updateOne(
  { folio_id: "FOL-301" },
  {
    $set: {
      folio_id: "FOL-301",
      booking_id: "B-1081",
      guest_id: "G-101",
      room_number: "201",
      charges: [
        {
          description: "Room Charge",
          amount: 3000,
          category: "Accommodation"
        },
        {
          description: "Restaurant Order ORD-9001",
          amount: 902,
          category: "Food"
        }
      ],
      total_charges: 3902,
      amount_paid: 2000,
      balance: 1902,
      status: "Pending"
    }
  },
  { upsert: true }
);

// ==========================================
// 6. HOUSEKEEPING CHECKLISTS
// ==========================================

db.housekeeping_checklists.updateOne(
  { checklist_id: "HK-201" },
  {
    $set: {
      checklist_id: "HK-201",
      room_number: "201",
      booking_id: "B-1081",
      assigned_to: "housekeeping_staff_01",
      date: new Date(),
      tasks: [
        { task: "Change bed sheets", completed: true },
        { task: "Clean bathroom", completed: true },
        { task: "Replace towels", completed: false },
        { task: "Restock toiletries", completed: false }
      ],
      status: "In Progress",
      remarks: "Room cleaning is in progress."
    }
  },
  { upsert: true }
);

// ==========================================
// 7. CREATE INDEXES
// ==========================================

db.restaurant_orders.createIndex({ order_id: 1 }, { unique: true });
db.restaurant_orders.createIndex({ booking_id: 1 });
db.restaurant_orders.createIndex({ delivery_status: 1 });

db.guest_reviews.createIndex({ review_id: 1 }, { unique: true });
db.guest_reviews.createIndex({ booking_id: 1 });
db.guest_reviews.createIndex({ rating: 1 });

db.audit_logs.createIndex({ log_id: 1 }, { unique: true });
db.audit_logs.createIndex({ timestamp: -1 });
db.audit_logs.createIndex({ actor: 1 });

db.folio_details.createIndex({ folio_id: 1 }, { unique: true });
db.folio_details.createIndex({ booking_id: 1 });

db.housekeeping_checklists.createIndex(
  { checklist_id: 1 },
  { unique: true }
);
db.housekeeping_checklists.createIndex({ room_number: 1 });
db.housekeeping_checklists.createIndex({ status: 1 });

print("Indexes created successfully!");

// ==========================================
// 8. READ OPERATIONS
// ==========================================

print("RESTAURANT ORDERS:");
db.restaurant_orders.find();

print("GUEST REVIEWS:");
db.guest_reviews.find();

print("AUDIT LOGS:");
db.audit_logs.find();

print("FOLIO DETAILS:");
db.folio_details.find();

print("HOUSEKEEPING CHECKLISTS:");
db.housekeeping_checklists.find();

// ==========================================
// 9. UPDATE OPERATION EXAMPLE
// ==========================================

// Change the delivery status of an order.
db.restaurant_orders.updateOne(
  { order_id: "ORD-9001" },
  { $set: { delivery_status: "Delivered" } }
);

// ==========================================
// 10. AGGREGATION QUERIES
// ==========================================

// A. Calculate total restaurant revenue.
print("TOTAL RESTAURANT REVENUE:");
db.restaurant_orders.aggregate([
  {
    $group: {
      _id: null,
      total_revenue: { $sum: "$total_amount" }
    }
  }
]);

// B. Calculate average guest rating.
print("AVERAGE GUEST RATING:");
db.guest_reviews.aggregate([
  {
    $group: {
      _id: null,
      average_rating: { $avg: "$rating" }
    }
  }
]);

// C. Count restaurant orders by delivery status.
print("ORDERS BY DELIVERY STATUS:");
db.restaurant_orders.aggregate([
  {
    $group: {
      _id: "$delivery_status",
      total_orders: { $sum: 1 }
    }
  }
]);

// D. Calculate total spending for each booking.
print("TOTAL SPENDING BY BOOKING:");
db.restaurant_orders.aggregate([
  {
    $group: {
      _id: "$booking_id",
      total_spent: { $sum: "$total_amount" }
    }
  }
]);

// ==========================================
// 11. DELETE OPERATION EXAMPLE
// ==========================================

// Example only: uncomment the next line to delete
// a specific review when you actually need to.
// db.guest_reviews.deleteOne({ review_id: "REV-501" });

// ==========================================
// 12. VERIFY DATABASE
// ==========================================

print("DATABASE NAME:");
print(db.getName());

print("COLLECTIONS:");
printjson(db.getCollectionNames());

print("DOCUMENT COUNTS:");
for (const name of collectionNames) {
  print(name + ": " + db.getCollection(name).countDocuments());
}

print("HOTEL PMS MONGODB SETUP COMPLETED!");
