# Seeded dead links

Input for the docs link gate, not documentation. `scripts/__tests__/docs-links.test.ts`
scans this directory with the exclusion lifted and asserts the exact issue list
it produces; the gate itself never reads here (`EXCLUDED_SOURCE_DIRS`).

Editing a line below shifts the line numbers that test pins.

## Dead — every one of these must be reported

- missing file: [gone](./no-such-file.md)
- missing anchor: [gone](./target.md#no-such-heading)
- anchor on a directory: [gone](./nested#top)
- escapes the repository: [gone](../../../../outside-the-repo.md)
- image: ![gone](./no-such-image.png)
- html attribute: <a href="./no-such-page.md">gone</a>
- the reference definition below

[gone-ref]: ./no-such-reference.md

## Live — none of these may be reported

- [file](./target.md)
- [heading anchor](./target.md#live-heading)
- [repeated heading anchor](./target.md#live-heading-1)
- [explicit html anchor](./target.md#html-anchor)
- [anchor in this file](#live--none-of-these-may-be-reported)
- [percent-encoded path](./target%2Emd)
- [query string](./target.md?plain=1)
- [line range on a non-markdown file](./nested/sample.txt#L2)
- [repo-absolute path](/README.md)
- [external url](https://example.com/no-such-file.md)
- [other scheme](mailto:nobody@example.com)
- [protocol-relative url](//example.com/no-such-file.md)
- an inline code span is not a link: `[gone](./no-such-inline.md)`

A fenced block is not a link either:

```md
[gone](./no-such-fenced.md)
<a href="./no-such-fenced.html">gone</a>
```
