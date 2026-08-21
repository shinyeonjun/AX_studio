---
name: document
description: Design document reading and document making in AX Studio. Ingest once, then decide; generate only when asked.
---

# Document

문서는 읽히는 일과 만들어지는 일이 다르다.

읽기는 `document.ingest`로 한 번 연다. 폴더에서 온 파일이면 그 파일을 가리킨다. 연 결과는 증거이고, 바로 이어지는 요약·분류는 그 증거 위의 판단이다. 전체를 다시 열지 않는다.

일부만 필요하면 이미 연 문서에서 페이지·청크·검색으로 들어간다.

만들기는 사용자가 문서를 달라고 한 일이다. HTML, DOCX, PDF는 그때의 capability다. 읽고 판단한 일을 문서로 내보내는 것과, Slack이나 메일로 보내는 것은 다른 일이다.

엔진이 글·표·OCR을 항상 준다는 가정을 하지 않는다. 있는 계약을 따른다.
