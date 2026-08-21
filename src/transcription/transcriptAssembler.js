class TranscriptAssembler {
  constructor() {
    this.items = new Map();
    this.nextOrder = 0;
  }

  ensureItem(itemId) {
    if (!itemId) {
      throw new Error("Transcript event thiếu item_id.");
    }

    if (!this.items.has(itemId)) {
      this.items.set(itemId, {
        itemId,
        order: this.nextOrder,
        partial: "",
        transcript: "",
        completed: false,
      });
      this.nextOrder += 1;
    }

    return this.items.get(itemId);
  }

  addDelta(itemId, delta) {
    const item = this.ensureItem(itemId);

    if (!item.completed && typeof delta === "string") {
      item.partial += delta;
    }

    return { ...item };
  }

  addChunk(itemId, chunk) {
    const item = this.ensureItem(itemId);

    if (item.completed || typeof chunk !== "string" || !chunk) {
      return { ...item };
    }

    const incoming = chunk.replace(/\s+/g, " ");
    const existing = item.partial;

    if (!existing) {
      item.partial = incoming.trimStart();
    } else if (incoming.startsWith(existing)) {
      // Some streaming APIs send a cumulative partial transcript.
      item.partial = incoming;
    } else if (!existing.endsWith(incoming)) {
      const needsSpace =
        !/\s$/.test(existing) &&
        !/^\s/.test(incoming) &&
        !/^[,.;:!?%)]/.test(incoming);
      item.partial = `${existing}${needsSpace ? " " : ""}${incoming}`;
    }

    return { ...item };
  }

  complete(itemId, transcript) {
    const item = this.ensureItem(itemId);
    item.transcript = typeof transcript === "string" ? transcript.trim() : "";
    item.completed = true;

    return { ...item };
  }

  getItems() {
    return [...this.items.values()]
      .sort((left, right) => left.order - right.order)
      .map((item) => ({ ...item }));
  }

  getTranscript({ includePartial = true } = {}) {
    return this.getItems()
      .map((item) => {
        if (item.completed) {
          return item.transcript;
        }

        return includePartial ? item.partial.trim() : "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
}

module.exports = {
  TranscriptAssembler,
};
