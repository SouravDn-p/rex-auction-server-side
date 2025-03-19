require("dotenv").config();
const express = require("express");
const cors = require("cors");
const port = process.env.PORT || 5000;
const app = express();
app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_KEY}@cluster0.npxrq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
console.log(uri);
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    console.log(
      "connected to mongodb",
      process.env.DB_USER,
      process.env.DB_KEY
    );
    const db = client.db("rexAuction");
    const userCollection = db.collection("users");
    const announcementCollection = db.collection("announcement");

    // users related apis

    // get all users api
    app.get("/users", async (req, res) => {
      try {
        const users = userCollection.find();
        const collections = await users.toArray();
        res.send(collections);
      } catch (error) {
        res.status(201).send("internal server error!");
      }
    });

    // Announcement Related apis

    // Save Announcement Data in DB
    app.post("/announcement", async (req, res) => {
      const announcementData = req.body;
      const result = await announcementCollection.insertOne(announcementData);
      res.send({ success: true, result });
    });



  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("RexAuction Running!");
});

app.listen(port, () => {
  console.log(`running in port ${port}`);
});
