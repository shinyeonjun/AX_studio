---
name: rdb
description: Design internal database reads. Discover the allowed schema, then query; do not invent writes.
---

# Relational database

DB는 내부 자료를 읽는 곳이다. 무엇을 봐도 되는지는 먼저 `rdb.schema.describe`로 본다. 조회는 `rdb.query.read`다. 쓰기는 없다.

테이블과 조건은 사용자가 말한 것과, 스키마에서 확인한 것이다. 행 제한이나 개인정보 필터를 임의로 얹지 않는다.

결과는 표다. 사람이 읽거나 메시지로 나가려면 그다음에 텍스트로 바꾼다. 그 표를 Slack이나 메일로 보내는 것은 별도 일이다.
