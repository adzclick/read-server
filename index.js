import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { MongoClient, ServerApiVersion, ObjectId } from 'mongodb';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// middleware
app.use(cors({
  origin: "http://localhost:5173",
  credentials: true,
}));
app.use(express.json());

// ── Static folder for uploaded images ──────────────────────
// Files saved to /uploads will be publicly reachable at
// http://localhost:3000/uploads/<filename>
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// ── Multer setup (disk storage) ─────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per file
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

// mongodb
console.log("DB_USER:", process.env.DB_USER);
console.log("DB_PASS:", process.env.DB_PASS ? "[loaded]" : "MISSING");

const uri = `mongodb+srv://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASS)}@cluster0.ddqaqpm.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let db;
let galleryCollection;
let projectsCollection;

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");

    db = client.db("readsSociety"); // change to your actual DB name if different
    galleryCollection = db.collection("gallery");
    projectsCollection = db.collection("projects");

    return client;
  } catch (err) {
    console.dir(err);
  }
}

export async function disconnectFromMongoDB() {
  // await client.close();
}

// Helper: turn a saved file into a full public URL
const toPublicUrl = (req, filename) =>
  `${req.protocol}://${req.get('host')}/uploads/${filename}`;

// ════════════════════════════════════════════════════════════
// GALLERY APIs  (matches AdminUpload.jsx -> POST /api/gallery/upload)
// ════════════════════════════════════════════════════════════

// GET all gallery images
app.get('/api/gallery', async (req, res) => {
  try {
    const images = await galleryCollection.find().sort({ createdAt: -1 }).toArray();
    res.status(200).json(images);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch gallery images.", error: err.message });
  }
});

// POST upload one or more images (field name: "images")
app.post('/api/gallery/upload', upload.array('images'), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "No images were uploaded." });
    }

    const docs = req.files.map((file) => ({
      filename: file.filename,
      imageUrl: toPublicUrl(req, file.filename),
      createdAt: new Date(),
    }));

    const result = await galleryCollection.insertMany(docs);

    const inserted = docs.map((doc, i) => ({
      _id: Object.values(result.insertedIds)[i],
      ...doc,
    }));

    res.status(201).json({ message: "Images uploaded successfully.", images: inserted });
  } catch (err) {
    res.status(500).json({ message: "Upload failed.", error: err.message });
  }
});

// DELETE a gallery image by id
app.delete('/api/gallery/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const image = await galleryCollection.findOne({ _id: new ObjectId(id) });

    if (!image) {
      return res.status(404).json({ message: "Image not found." });
    }

    // remove the file from disk too
    const filePath = path.join(uploadsDir, image.filename);
    fs.unlink(filePath, (err) => {
      if (err) console.log("Could not delete file from disk:", err.message);
    });

    await galleryCollection.deleteOne({ _id: new ObjectId(id) });
    res.status(200).json({ message: "Image deleted." });
  } catch (err) {
    res.status(500).json({ message: "Delete failed.", error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// PROJECT SECTION APIs (matches AdminProjectSection.jsx)
// ════════════════════════════════════════════════════════════

// GET all projects
app.get('/api/projects', async (req, res) => {
  try {
    const projects = await projectsCollection.find().sort({ createdAt: -1 }).toArray();
    res.status(200).json(projects);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch projects.", error: err.message });
  }
});

// POST create a new project (field name: "image", plus title/location/stat/description)
app.post('/api/projects', upload.single('image'), async (req, res) => {
  try {
    const { title, location, stat, description } = req.body;

    if (!title || !location || !description) {
      return res.status(400).json({ message: "Title, location and description are required." });
    }

    if (!req.file) {
      return res.status(400).json({ message: "A cover image is required." });
    }

    const newProject = {
      title,
      location,
      stat: stat || "",
      description,
      filename: req.file.filename,
      imageUrl: toPublicUrl(req, req.file.filename),
      createdAt: new Date(),
    };

    const result = await projectsCollection.insertOne(newProject);

    res.status(201).json({
      message: "Project created successfully.",
      project: { _id: result.insertedId, ...newProject },
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to create project.", error: err.message });
  }
});

// DELETE a project by id
app.delete('/api/projects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const project = await projectsCollection.findOne({ _id: new ObjectId(id) });

    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    const filePath = path.join(uploadsDir, project.filename);
    fs.unlink(filePath, (err) => {
      if (err) console.log("Could not delete file from disk:", err.message);
    });

    await projectsCollection.deleteOne({ _id: new ObjectId(id) });
    res.status(200).json({ message: "Project deleted." });
  } catch (err) {
    res.status(500).json({ message: "Delete failed.", error: err.message });
  }
});

// ── Multer error handler (file too large, wrong type, etc.) ──
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message === 'Only image files are allowed') {
    return res.status(400).json({ message: err.message });
  }
  next(err);
});

app.get('/', (req, res) => {
  res.send('Hello World!');
});

connectToMongoDB().then(() => {
  app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
  });
});