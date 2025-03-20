require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const port = process.env.PORT || 5000;

const app = express();
app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
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


    // JWT 
    app.post("/jwt", async(req, res)=>{
      const user = req.body;
      const token = jwt.sign(user, process.env.JWT_SECRET,{expiresIn: "1h"});
      res.send(token);
    })

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

    // get all announcement

    app.get("/announcement", async (req, res) => {
      const result = await announcementCollection.find().toArray();
      res.send(result);
    });

    // Save Announcement Data in DB
    app.post("/announcement", async (req, res) => {
      const announcementData = req.body;
      const result = await announcementCollection.insertOne(announcementData);
      res.send({ success: true, result });
    });

    // Announcement Delete api
    app.delete("/announcement/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };

      const result = await announcementCollection.deleteOne(filter);
      res.send(result);
    });

    //  update announcement api
    app.put("/announcement/:id", async (req, res) => {
      const { title, content, date, image } = req.body;
      const announcementId = req.params.id;

      try {
        const result = await announcementCollection.updateOne(
          { _id: new ObjectId(announcementId) }, 
          {
            $set: {
              title,
              content,
              date,
              image, 
            },
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Announcement not found" });
        }

        res.status(200).json({
          message: "Announcement updated successfully",
        });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to update the announcement" });
      }
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
