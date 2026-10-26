
const express = require("express");
const { MongoClient } = require("mongodb");
const cors = require("cors");

const app = express();
const PORT = 5000;

const MONGO_URI = "mongodb://127.0.0.1:27017";
const DB_NAME = "hotel_mongodb";

app.use(cors());
app.use(express.json());

let db;

async function startServer() {
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();

    db = client.db(DB_NAME);

    console.log("Connected to MongoDB:", DB_NAME);

    app.get("/", (req, res) => {
      res.json({
        message: "Hotel Management System API is running"
      });
    });

    app.get("/api/health", async (req, res) => {
      try {
        await db.command({ ping: 1 });
        res.json({ status: "connected", database: DB_NAME });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get("/api/collections", async (req, res) => {
      try {
        const collections = await db.listCollections().toArray();
        res.json(collections.map(item => item.name));
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get("/api/orders", async (req, res) => {
      try {
        const orders = await db
          .collection("restaurant_orders")
          .find({})
          .limit(100)
          .toArray();

        res.json(orders);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get("/api/reviews", async (req, res) => {
      try {
        const reviews = await db
          .collection("guest_reviews")
          .find({})
          .limit(100)
          .toArray();

        res.json(reviews);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get("/api/housekeeping", async (req, res) => {
      try {
        const tasks = await db
          .collection("housekeeping_checklists")
          .find({})
          .limit(100)
          .toArray();

        res.json(tasks);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get("/api/folios", async (req, res) => {
      try {
        const folios = await db
          .collection("folio_details")
          .find({})
          .limit(100)
          .toArray();

        res.json(folios);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get("/api/audit-logs", async (req, res) => {
      try {
        const logs = await db
          .collection("audit_logs")
          .find({})
          .limit(100)
          .toArray();

        res.json(logs);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.listen(PORT, () => {
      console.log(`Backend running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start backend:", error.message);
    process.exit(1);
  }
}

startServer();
