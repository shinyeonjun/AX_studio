---
name: gmail
description: Design Gmail as a start, a lookup, a draft, or a send in AX Studio workflows.
---

# Gmail

메일은 네 가지 일 중 하나다. 들어오는 일, 찾아보는 일, 써 두는 일, 보내는 일.

새 메일이 오면 시작되는 일은 `gmail.new_message`다. 누구·무슨 제목인지는 문이 열리기 전에 거른다. 본문을 읽고 나서 거르지 않는다.

이미 와 있는 한 통을 읽는 일과, 예전에 쌓인 메일을 찾는 일은 다르다. 지금 이벤트 메일은 `gmail.messages.read`로 그 메일을 가리켜 읽고, 찾아보는 일은 `gmail.messages.search`다.

초안과 발송도 다르다. 사용자가 보내 달라고 한 것만 `gmail.message.send`다. 써 두기만 하면 `gmail.draft.create`다.

계정과 수신자는 연결된 값이나 사용자가 말한 값이다. 주소를 지어내지 않는다. 메일을 보내는 노드가 여러 개면 수신자도 노드마다 따로다.
