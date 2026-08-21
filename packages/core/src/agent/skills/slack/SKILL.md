---
name: slack
description: Design Slack as a place to listen or a place to tell, with one channel per send node.
---

# Slack

Slack은 듣는 곳이거나 말하는 곳이다.

채널에서 일이 시작되면 `slack.new_message`다. 어떤 말을 기다릴지는 시작 조건으로 둔다.

알리거나 보고하는 일은 `slack.message.send`다. 보낼 채널과 말은 그 노드의 것이다. 같은 알림을 여러 갈래로 보내면 채널도 여러 개다. 한 채널 값으로 묶지 않는다.

본문은 앞 단계 결과를 가리킨다. Slack이 읽는 글자로 쓴다. 굵게 `*텍스트*`, 기울임 `_텍스트_`.

사용자가 알리겠다고 한 일에만 Slack을 그린다.
