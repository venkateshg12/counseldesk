import { createHash } from "node:crypto";
import { loadPages, splitSections } from "@repo/content";
import { db, orm } from "../prisma/db.js";
import { embedDocuments } from "../ai/embeddings.js";
import { documentInput } from "../constants/embedding.js";
import { NVIDIA_EMBEDDING_MODEL } from "../constants/env.js";
import { logger } from "../utils/logger.js";

export const ingestPages = async ({
  depth,
  force = false,
}: {
  depth: 2 | 3;
  force?: boolean;
}) => {
  const pages = loadPages();
  const stored = await orm.Page.select("id", "path", "contentHash").all();
  const storedByPath = new Map(stored.map((p) => [p.path, p]));

  let skipped = 0;
  let ingested = 0;

  for (const page of pages) {
    // Everything that decides the stored sections. Change any of it and the page is redone.
    const ingestHash = createHash("sha256")
      .update(
        `${page.contentHash}|depth=${depth}|model=${NVIDIA_EMBEDDING_MODEL}`,
      )
      .digest("hex");

    const existing = storedByPath.get(page.path);
    if (existing?.contentHash === ingestHash && !force) {
      skipped++;
      continue;
    }

    const drafts = splitSections(page, { depth });
    // Network first, outside any transaction.
    const vectors = await embedDocuments(
      drafts.map((d) =>
        documentInput(`${page.title} > ${d.heading}`, d.content),
      ),
    );

    await db.transaction(async (tx) => {
      const pageRow = existing
        ? await tx.orm.public.Page.where({ id: existing.id }).update({
            title: page.title,
            contentHash: ingestHash,
            updatedAt: new Date().toISOString(),
          })
        : await tx.orm.public.Page.create({
            path: page.path,
            title: page.title,
            contentHash: ingestHash,
          });

      // Replace, not merge: simpler than diffing, and the whole page is one atomic swap.
      await tx.orm.public.Section.where({ pageId: pageRow!.id }).deleteAll();
      for (const [i, draft] of drafts.entries()) {
        await tx.orm.public.Section.create({
          pageId: pageRow!.id,
          anchor: draft.anchor,
          heading: draft.heading,
          content: draft.content,
          searchText: draft.searchText,
          position: draft.position,
          contentHash: draft.contentHash,
          embedding: vectors[i]!,
          embeddingModel: NVIDIA_EMBEDDING_MODEL,
        });
      }
    });

    ingested++;
    logger.info(`ingested ${page.path} (${drafts.length} sections)`);
  }

  // Pages whose markdown file was deleted. Their sections go with them (cascade).
  const livePaths = new Set(pages.map((p) => p.path));
  const removedIds = stored
    .filter((p) => !livePaths.has(p.path))
    .map((p) => p.id);
  if (removedIds.length) {
    await orm.Page.where((p) => p.id.in(removedIds)).deleteAll();
  }

  return { ingested, skipped, removed: removedIds.length };
};
