---
name: transform
description: Convert table or document artifacts to text only when the next step needs text.
---

# Transform

변환은 일을 하는 노드가 아니라, 다음 노드가 받을 수 있게 모양을 맞추는 일이다.

표가 필요한 곳에 표가 있으면 그대로 둔다. 글이 필요한 곳에 표가 있으면 `transform.table_to_text`다. 문서가 글이 필요하면 `transform.document_to_text`다.

앞 단계 결과를 가리킨다. 내용을 복사해 넣지 않는다. 다음이 이미 그 계약을 받으면 변환을 끼워 넣지 않는다.
