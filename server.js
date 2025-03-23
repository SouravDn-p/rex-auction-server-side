require("dotenv").config();
const express = require("express");
const cors = require("cors"); 
const jwt = require("jsonwebtoken");
const port = process.env.PORT || 5000;

const app = express();
app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const req = require("express/lib/request");
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
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN, { expiresIn: "1h" });
      console.log(token);
      res.send(token);
    })

    // Auth Middleware
    const verifyToken = (req, res, next) => {
      console.log("inside verify token", req.headers.authorization);
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized request" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN, (error, decoded) => {
        if (error) {
          return res.status(403).send({ message: 'forbidden access' })
        }
        req.decoded = decoded;
        next();
      })
    }

    // verify admin middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === 'admin';
      if (!isAdmin) {
        return res.status(401).send({ message: 'unauthorized request' })
      }
      next();
    }

    // verify manager middleware 
    const verifyManager = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isManager = user?.role === 'manager';
      if (!isManager) {
        return res.status(401).send({ message: 'unauthorized request' })
      }
      next();
    }

    // verify seller middleware 
    const verifySeller = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isSeller = user?.role === 'seller';
      if (!isSeller) {
        return res.status(401).send({ message: 'unauthorized request' })
      }
      next();
    }






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


       // user data save in db
       app.post("/users", async (req, res) => {
        const user = req.body;
        // Check if the user already exists based on email
        const query = { email: user.email };
        const existingUser = await userCollection.findOne(query);
        if (existingUser) {
          return res.status(201).send(existingUser);
        }
        // Save the new user
        const result = await userCollection.insertOne(user);
        res.status(201).send(result);
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



// 2:02 pm 23-3-25

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const port = process.env.PORT || 5000;

const app = express();

app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const req = require("express/lib/request");
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
    const auctionCollection = db.collection("auctionsList");
    const announcementCollection = db.collection("announcement");


    // JWT 
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN, { expiresIn: "1h" });
      console.log(token);
      res.send(token);
    })

    // Auth Middleware
    const verifyToken = (req, res, next) => {
      console.log("inside verify token", req.headers.authorization);
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized request" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN, (error, decoded) => {
        if (error) {
          return res.status(403).send({ message: 'forbidden access' })
        }
        req.decoded = decoded;
        next();
      })
    }

    // verify admin middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === 'admin';
      if (!isAdmin) {
        return res.status(401).send({ message: 'unauthorized request' })
      }
      next();
    }

    // // verify manager middleware 
    // const verifyManager = async (req, res, next) => {
    //   const email = req.decoded.email;
    //   const query = { email: email };
    //   const user = await userCollection.findOne(query);
    //   const isManager = user?.role === 'manager';
    //   if (!isManager) {
    //     return res.status(401).send({ message: 'unauthorized request' })
    //   }
    //   next();
    // }

    // verify seller middleware 
    const verifySeller = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isSeller = user?.role === 'seller';
      if (!isSeller) {
        return res.status(401).send({ message: 'unauthorized request' })
      }
      next();
    }






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


       // user data save in db
       app.post("/users", async (req, res) => {
        const user = req.body;
        // Check if the user already exists based on email
        const query = { email: user.email };
        const existingUser = await userCollection.findOne(query);
        if (existingUser) {
          return res.status(201).send(existingUser);
        }
        // Save the new user
        const result = await userCollection.insertOne(user);
        res.status(201).send(result);
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


    // Auction related apis
    // get all auctions
    app.get('/auctions', async (req, res) => {
      try {
        const email = req.query.email; 
        const filter = email ? { email: email } : {};
        const result = await auctionCollection.find(filter).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: 'Internal Server Error', error });
      }
    });

    app.post('/auctions', async (req, res) => {
      const auction = req.body;
      const result = await auctionCollection.insertOne(auction);
      res.send(result);
    });

    // app.patch('')



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
