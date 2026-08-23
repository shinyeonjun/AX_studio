---
name: document
description: Design document reading and document making in AX Studio. Ingest once, then decide; generate only when asked.
---

# Document

문서는 읽히는 일과 만들어지는 일이 다르다.

읽기는 `document.ingest`로 한 번 연다. 폴더에서 온 파일이면 그 파일을 가리킨다. host가 로컬 문서 엔진(기본 Docling)으로 PDF의 글·표·OCR을 추출하고, 그 결과가 증거가 된다. Docling을 직접 실행하거나 PDF 바이트를 임의로 다루지 않는다.

일부만 필요하면 이미 연 문서에서 페이지·청크·검색으로 들어간다.

만들기는 사용자가 문서를 달라고 한 일이다. HTML, DOCX, PDF는 그때의 capability다. 읽고 판단한 일을 문서로 내보내는 것과, Slack이나 메일로 보내는 것은 다른 일이다.

엔진이 글·표·OCR을 항상 준다는 가정을 하지 않는다. 있는 계약을 따른다.
