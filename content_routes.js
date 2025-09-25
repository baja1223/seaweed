import { Router } from "express";
import { Item } from "./content_models.js";

const r = Router();

// Create
r.post("/items", async (req, res) => {
  try {
    const { title, description, tags, authorId } = req.body || {};
    if (!title) return res.status(400).json({ error: "title is required" });
    const doc = await Item.create({ title, description, tags, authorId });
    return res.status(201).json({ item: doc });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "create failed" });
  }
});

// List
r.get("/items", async (_req, res) => {
  const items = await Item.find({}).sort({ createdAt: -1 }).limit(100);
  return res.json({ items });
});

// Read by id
r.get("/items/:id", async (req, res) => {
  const doc = await Item.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: "not found" });
  return res.json({ item: doc });
});

// Update
r.put("/items/:id", async (req, res) => {
  try {
    const updates = req.body || {};
    const doc = await Item.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!doc) return res.status(404).json({ error: "not found" });
    return res.json({ item: doc });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "update failed" });
  }
});

// Delete
r.delete("/items/:id", async (req, res) => {
  const out = await Item.findByIdAndDelete(req.params.id);
  if (!out) return res.status(404).json({ error: "not found" });
  return res.json({ ok: true });
});

export default r;

