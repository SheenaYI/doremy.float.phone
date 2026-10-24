"use client";

import type { DiaryEntryBlock } from "@/lib/diary-entry-types";

export function DiaryBlockView({ block }: { block: DiaryEntryBlock }) {
  if (block.type === "quote") {
    return <blockquote className="diary-entry-quote">{block.text}</blockquote>;
  }
  if (block.type === "highlight") {
    return <p className="diary-entry-paragraph"><mark className="diary-entry-highlight">{block.text}</mark></p>;
  }
  if (block.type === "bold") {
    return <p className="diary-entry-paragraph diary-entry-bold">{block.text}</p>;
  }
  if (block.type === "italic") {
    return <p className="diary-entry-paragraph diary-entry-italic">{block.text}</p>;
  }
  if (block.type === "list") {
    const ListTag = block.ordered ? "ol" : "ul";
    return (
      <section className="diary-entry-rich-list">
        {block.title ? <h3>{block.title}</h3> : null}
        <ListTag>
          {block.items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
        </ListTag>
      </section>
    );
  }
  if (block.type === "correction") {
    return (
      <p className="diary-entry-correction">
        <del>{block.text}</del>
        {block.replacement ? <ins>{block.replacement}</ins> : null}
      </p>
    );
  }
  if (block.type === "todo") {
    return (
      <section className="diary-entry-todo">
        {block.title ? <h3>{block.title}</h3> : null}
        <ul>
          {block.items.map((item, index) => (
            <li key={`${item.text}-${index}`} data-done={item.done ? "true" : "false"}>
              <span />
              <p>{item.text}</p>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  if (block.type === "image") {
    return (
      <figure className="diary-entry-image-block">
        <div>{block.description}</div>
        {block.caption ? <figcaption>{block.caption}</figcaption> : null}
      </figure>
    );
  }
  return <p className="diary-entry-paragraph">{block.text}</p>;
}
