# 유한 PDF span의 행 묶기에서 최신 행만 검사한다

**상태: 사후 기록·독립 ADR 검토 대기.** 2026-10-02 UTC. 코드 작성 전 ADR 검토 지시를 받기 전에 로컬 후보 `e9eff762a4ab3ff32865600246bb145717f8c084`를 이미 구현·검증했다. 이 문서는 선행 승인이나 배포 기록이 아니다. 기준은 `3dd272aaeffc5feb42ab63ce8507357f3baae965`이며, 검토 답변 전에는 제품 코드를 더 변경하지 않는다. 실제 정책과 검증 상태를 구분하는 [프로젝트 결정 기록](../project/architecture-decisions.md)의 관례를 따른다.

## 문제와 제약

[`write/pdf_report.py::_rows`](../../packages/document-engine/src/write/pdf_report.py)는 `(page_index, y, x)`로 정렬한 뒤 span마다 기존 행 전체를 역순 탐색한다. 한 행에 span 하나인 입력에서는 grouping 검사량이 `n(n-1)/2`가 된다. 이번 범위는 이 독립적인 병목 하나이며, PDF/OCR 전체나 다른 이차 알고리즘을 최적화했다는 뜻은 아니다.

행의 최초 span을 anchor로 쓰는 방식, 포함 경계 `abs(anchor_y - y) <= 1.75`, 최종 x 정렬, 안정적인 동일 키 순서, 객체 identity·중복, 반환 구조와 기존 예외·콜백 순서를 보존해야 한다. NaN·무한대·미검증 타입을 새로 거부하거나 변환하지 않는다. 실제 사용자 PDF·외부 API·키·DB는 쓰지 않으며 기존 테스트·skip·timeout을 완화하지 않는다.

## 대안과 선택

| 대안 | 효과와 비용 | 판단 |
| --- | --- | --- |
| 변경 없음 | 호환성 위험과 guard 비용이 없고 sparse grouping은 계속 이차 비용 | 가능한 기본안이자 롤백 대상 |
| 페이지·y별 탐색 인덱스와 legacy fallback | 후보 탐색을 줄일 수 있지만 anchor·tolerance·순서·타입 처리를 위한 상태와 검증이 늘어남 | 가능하지만 이번 작은 변경에는 불필요 |
| 입력 조건을 확인한 최신 행 검사와 legacy fallback | 정상 grouping을 선형으로 줄이고 기존 정렬·구조 유지; 입력 확인 때문에 dense 비용 증가 가능 | **현재 로컬 후보의 선택**, 승인 대기 |
| 조건 없이 최신 행 검사 | 가장 단순하지만 NaN 장벽이나 부작용 있는 정렬 키에서 결과가 달라짐 | 호환성 제약을 위반하므로 제외 |

선택한 후보는 정렬 전에 입력이 정확한 내장 list이고, 각 항목이 정확한 `_Span`, 내장 int 페이지, 길이 4의 내장 tuple, 네 개의 유한 내장 float인지 확인한다. 큰 int 페이지와 음수 페이지는 변환 없이 허용한다. bool·정수 좌표·혼합/사용자 정의 타입·비정상 shape·누락 필드는 기존 탐색으로 보낸다. `getattr` 기본값과 타입 검사의 단락 평가로 새 validation 예외나 미검증 메서드 호출을 만들지 않는다.

확인에 성공한 일반 frozen `_Span`과 내장 값에는 정렬 중 사용자 정의 비교 콜백이 없다. 페이지가 연속이고 같은 페이지의 y·anchor가 증가하므로 최신 anchor가 tolerance 밖이면 더 이전 anchor도 맞지 않는다. 최신 행이 맞으면 원래 역순 탐색도 그것을 먼저 고른다. 확인 실패 시 함수 전체가 원래 탐색을 쓴다. 호출 중 외부에서 입력이나 helper/built-in을 변경하지 않는 통상적인 실행 조건이 전제다.

## 검증 가능한 효과와 위험

아래는 이 선택을 검토하기 위한 구조적 가설을 **사후에 명문화**한 것이며, 이미 나온 측정에 맞춘 사전 승인 기준이 아니다.

- 정상 grouping은 최대 `max(0, n-1)`행 검사, 전체 함수는 두 정렬을 포함해 최악 `O(n log n)`, 추가 공간은 `O(n)`이어야 한다. 임의 크기 페이지 int의 비교 비용은 별도이며 B-bit 비교를 항상 상수 비용으로 보지 않는다.
- fallback은 원본의 성공/실패, 정확한 예외 타입·args와 사용자 정의 연산 순서를 유지하고 최악 이차 비용을 그대로 가진다. 모든 입력이 선형이 된다는 주장은 하지 않는다.
- 이미 한 행에 모이는 dense 입력에는 asymptotic 이득이 없고 guard 때문에 느려질 수 있다. 실사용 입력 비율과 전체 PDF/OCR 지연 효과는 미검증이다.
- 정렬 뒤에만 조건을 검사하면 custom comparator가 좌표를 일반 float로 바꿔 미검증 입력이 fast path에 들어갈 수 있다. 이 사후 검사 후보는 새 회귀 테스트에서 실제 실패했고 현재 후보는 정렬 전에 조건을 확정한다.

## 관측된 검증

원본 oracle의 AST를 기준 커밋과 대조했다. 전체 document-engine 테스트는 기준 89/89, 최종 후보 90/90이며 기존 76개 테스트는 변경하지 않았다. 크기 128~8192의 8개 layout, 500개 seeded layout, ±1.75 경계와 바깥, 동일 키·객체, 여러 페이지, nonfinite/큰 정수/bool/혼합 타입, 누락 필드·사용자 정의 콜백을 차등 검증했다. 행 내용뿐 아니라 원본 span identity·순서, 입력 순서, 예외 및 연산 순서를 확인한다. compileall, diff whitespace, 원본에 대한 patch 적용과 Git blob 일치 검사도 통과했다. Python 정적 타입 검사기는 설정되어 있지 않으며 Node/Core/Desktop 전체 검증은 이 단계에서 실행하지 않았다.

같은 Python 3.11.16·Windows 프로세스에서 구현별 시간 21회와 별도 traced Python 메모리 5회를 번갈아 측정했다. 계측 검사량은 시간 측정과 분리했다. `n=8192`에서:

| 입력/지표 | 원본 | 후보 |
| --- | ---: | ---: |
| 행당 하나, median/p95 ms | 1954.185 / 2010.739 | 5.3621 / 6.8911 |
| 행당 하나, 행 검사 | 33,550,336 | 8,191 |
| 행당 하나, traced peak bytes | 785,664 | 785,240 |
| 동일 y 한 행, median/p95 ms | 6.6761 / 9.1197 | 8.7597 / 11.1463 |
| nonfinite fallback, median ms | 4732.4775 | 4739.8845 |

sparse median은 364.44배 개선되고 dense median은 31.2% 증가했다. 이는 두 정렬을 포함한 합성 `_rows` 측정이다. 424바이트 차이를 공간 복잡도 개선으로 보지 않는다. 공유 환경의 부하·주파수는 통제하지 않았고 empirical p95는 tail 보장이 아니다.

재현은 `python -m unittest discover -s packages/document-engine/src -p '*_test.py' -v`와 [`pdf-rows-benchmark.py`](../../packages/document-engine/scripts/pdf-rows-benchmark.py)를 사용한다. task-4의 `evidence/`에는 oracle, 의도된 실패 로그, 56개 케이스의 raw samples·hashes·환경·scaling·패치 검사 결과가 있으며 `pdf-rows-evidence.zip`으로 묶었다. 이 로컬 자료는 제품 배포 artifact가 아니다.

## 제안된 도입과 롤백

**미구현·검토 대상:** 부모가 이 ADR과 코드의 의미 보존 근거를 독립적으로 검토하고, 현재 dense 비용을 수용할지 판정한 뒤 PR·통합 검증·main 병합·canonical 동기화를 순서대로 처리한다. 새로운 입력 타입의 fast path 확대, 추가 자료구조, dense 특례는 이 결정에 포함되지 않으며 구현 전에 별도 가설·검토가 필요하다.

내용·identity·순서·예외/콜백·계약에서 하나라도 차등 회귀가 나오면 통합을 보류하고 원본 `_rows`로 되돌린다. 정상 행 검사량이 선형이라는 가설이 깨지거나 통합 워크로드의 성능 예산을 넘으면 도입을 보류/롤백한다. 그런 예산은 아직 정해지지 않았으며 관측한 dense 수치에 맞춰 임의 임계치를 만들지 않는다. 원본 oracle과 재현 자료는 롤백 판단의 기준으로 유지한다. 현재는 로컬 후보와 이 회고 문서만 있으며 PR·main·canonical·installer 조작은 실행하지 않았다.
