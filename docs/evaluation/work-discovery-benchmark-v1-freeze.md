# Work Discovery Benchmark v1 freeze manifest

이 manifest는 2026-09-04 11:41:24 +09:00에 마지막 재실행을 마친 뒤
benchmark 계약과 대표 결과 artifact의 SHA-256을 기록한 것이다. 외부
fixture와 report는 저장소에 복사하지 않고 `D:\ax\_test`에 보존한다.

## 대표 결과 artifact

```text
2FA35CF38B5D4AACD98788D15CD667A0EE185F3337B9E20B1F27DA58BA3CE414  D:\ax\_test\runs\latest.json
C8229C3CCEC7F949000AAA2BE0C806E66DAE34A6EAC23650BE8C7D6D54CCCC2A  D:\ax\_test\profiles\holdout\runs\latest.json
C11A1343D14D56CD67CEC59B5E3211F01F6201877B458DB3738D09291E06888D  D:\ax\_test\profiles\expanded\runs\latest.json
23B4C8306A85D8058696D8B4811B715DAFBFE073B1905D3EBBA58ACC73288CED  D:\ax\_test\sweeps\expanded\runs\latest-aggregate.json
```

대표 aggregate는 `profile=expanded`, `seedCount=10`, `cases=300`이며,
Full의 stored arithmetic은 `correctPublish=196/200`,
`unsafePublish=30/226`, `safeDecision=266/300`이다.

## benchmark 계약 파일

```text
76C9605062FD365DE762A921534657A140DC0E3035D3BD965146829C6FA3D0A9  test/work-discovery-benchmark/cases.mjs
A478F646411089146BE04659C9A9AE655C68DC3CA9695FCF912972F7172F79D4  test/work-discovery-benchmark/evaluate.mjs
41CB6888F10633F76BA3BE7CB7FA9A191A7C93424E2F33D175001C392D78EB60  test/work-discovery-benchmark/expansion-cases.mjs
DAF318E4055C47BD721015CEEEF03A293F7FFC6DFFAB6D5E2060D3F69971E04B  test/work-discovery-benchmark/fixture-factory.mjs
67C29A3473BE63704EB79B0B47CCE5B2A62A2A125A2EF788AA5C7FB5EB2442D7  test/work-discovery-benchmark/report.mjs
0FA1E32F238E30314143849C9923F6E0204A340FCC10E5962DBA9A9DCAD8BCF5  test/work-discovery-benchmark/run.mjs
3B9089EDDC45651A6F02C38F1D0EC1031CE67CFFEE25B4DBDCF213B1A369E526  test/work-discovery-benchmark/sweep-report.mjs
062E545AEDDD623831B4ACA24E956F718F520B95A8A46FFF4826CE72970D23E2  test/work-discovery-benchmark/sweep.mjs
BB23881A99B0408588330E2A8DF35769587DEF0C5D40642B85E85ADBA131BD0F  test/work-discovery-benchmark/verify-report.mjs
495BB53AD69E8AEB25CDA2DD46A00F02892C73B04DF69552C017AD0B67F371DB  docs/evaluation/work-discovery-benchmark-v1.md
93FDAC9A9A86EE4BDDF01C8320992AA6380DEA76B4AB5189365C74B0983869EC  docs/evaluation/work-discovery-holdout-findings.md
```

## 동결 규칙

- 위 계약·fixture·gold·seed·지표 정의를 바꾸지 않는다.
- 변경이 필요하면 `v1.1` 또는 별도 실험 ID로 새 baseline과 비교 결과를
  남긴다.
- B24~B26 failure row와 hidden holdout evidence를 삭제하거나 재분류하지
  않는다.
- 결과 문서는 분석을 위한 것이며, 이 동결 작업 자체는 제품 동작을 바꾸지
  않는다.
