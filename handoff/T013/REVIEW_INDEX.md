# P022 LocatorStress — T013 REVIEW_INDEX

- 项目：P022 LocatorStress（定位器压力台）
- 版本：`0.1.0`（package.json）
- 审查 commit：`a78d765`（`P022 S4: PASS record`；S0–S4 全部 PASS）
  - `git rev-parse HEAD` = `a78d7653da754dcfae26615cc48838aef1e4b585`
  - 父提交：`66f87a2`（S4 协调员 PASS 记录）、`5f075f3`（T012）、`35366d3`（T011）
- 审查者：T013 独立审查员（全新会话，未参与任何实现工作）
- 审查时间：2026-11-11 ~06:10–06:55 GMT
- 规格：SPEC_VERSION `1.0.0`，SPEC_FROZEN；seed `P022-LOCATORSTRESS-S0-2026-11-10`
- 结论：**FINAL_VERDICT: PASS**（P0 0 / P1 0 / P2 25，见 `INDEPENDENT_REVIEW.md`）

## 工作树状态

- 审查期间未修改任何已跟踪文件；审查结束时 `git status` 干净（已跟踪文件无改动）。
- 未跟踪文件（非本次审查创建，不影响结论）：
  - `coverage/`（测试覆盖率生成物，未入仓）
  - `handoff/S5_COORDINATOR_STATE.md`（审查期间由协调员写入，本次审查未碰）
  - `handoff/T013/`（本次审查产出）
- `dist/`、`node_modules/` 在 `.gitignore` 中，未入仓；共 199 个已跟踪文件。

## 规格到实现映射

| 规格要求 | 实现位置 | 状态 |
|---|---|---|
| LocatorSpec §4.1（css/xpath/role，framePath 0–2，index） | `src/contracts/locator.ts`（validate/parse/normalize） | 符合 |
| 四态 verdict §4.2/§5.2（STABLE/WRONG_TARGET/AMBIGUOUS/MISSING；执行错误独立 status） | `src/verdict/classify.ts`；门禁侧独立复现于 `scripts/s0-gate.ts` deriveVerdict | 符合 |
| Oracle identity §4.3（私有 manifest 路径、Node-side handle 比较、无 DOM marker、CDP ID 不入报告） | `src/oracle/target-capture.ts`、`identity-compare.ts`、`oracle-runner.ts` | 符合 |
| S0 固定样本 §4.4（24 页、每类 8、稳定/脆弱各 12、M01–M08、192 例） | `src/fixtures/pages/`、`oracle-manifests/`、`golden/expected-verdicts.json`、`src/mutations/` | 符合（192/192） |
| Hash 契约 §4.5（scenario/oracle/analysis/gate；NFC、键码点序、禁时间/UUID/PID/路径/CDP ID） | `src/canonical/canonical-json.ts`、`hashes.ts`、`forbidden-scan.ts` | 符合（四哈希独立重算 MATCH） |
| 稳定性分数 §5.5（100×stable/completed；incomplete 不计分但降 coverage） | `src/score/stability-score.ts`（BigInt 精确半入） | 符合 |
| 有界 BFS §5.6/§5.7（深度 ≤6、状态 ≤4096、固定算子序、tie-break、去重、BOUNDED_* 诚实上报） | `src/search/bfs.ts`、`state-key.ts`、`browser-evaluator.ts` | 符合 |
| Witness 与分析 API/JSON §5.7/T008 | `src/analysis/witness.ts`、`src/contracts/report.ts`、`src/api/`、`src/export/json-export.ts` | 符合（遗留见 P2-03/04/05/25） |
| Web UI §7.2/T009（Fixture Lab、Locator 编辑、Mutation Lab、Verdict Matrix、BFS Witness、Report） | `src/ui/` | 符合（遗留见 P2-08/09/10） |
| 离线 HTML/JSON 导出 §7.3/T010（自包含、转义、零外部资源） | `src/export/html-export.ts`、`html-escape.ts`、`templates/report.html.ts` | 符合（遗留见 P2-11） |
| 全量测试/变异/Oracle parity T011 | `tests/`（39 文件 509 测试）、`scripts/t011-mutation-runner.mjs` | 通过（变异 40/40；范围见 P2-21） |
| E2E/离线/性能/压力 T012 | `tests/e2e/` | 通过（数字见 P2-18） |
| 隐私/离线/供应链 §10（零外网、合成数据、loopback、lockfile 固定、许可证待定） | `src/runner/browser.ts`（route 拦截）、`src/api/server.ts`、`src/ui/server.ts` | 符合（依赖许可清单缺失见 P2-20） |
| 风险分级 §11（P0 项全部受控） | 见 `INDEPENDENT_REVIEW.md` §7 | 全部通过 |

## 任务状态

| 阶段 | 任务 | 状态 |
|---|---|---|
| S0 | T001–T003 | PASS（门禁本次重跑 PASS） |
| S1 | T004–T006 | PASS |
| S2 | T007–T008 | PASS |
| S3 | T009–T010 | PASS |
| S4 | T011–T012 | PASS |
| S5 | T013 独立审查 | **PASS**（本审查） |
| S5 | T014 正式冻结 | 待派发（依赖 T013 PASS） |

## 测试命令与退出码（审查者亲自重跑）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm run typecheck` | 0 | 通过 |
| `npm run typecheck:scripts` | 0 | 通过 |
| `npm run build` | 0 | 通过 |
| `npm test` | 0 | 39 文件，509/509，270.46 s |
| `npm run test:oracle` | 0 | oracle 脚本 PASS；fixtures 3/3；mutations 3/3 |
| `npm run test:e2e` | 0 | 7/7 |
| `npm run test:offline` | 0 | 6/6 |
| `npm run test:stress` | 0 | 6/6 |
| `npm run s0:gate`（完整） | 0 | GATE PASS；192/192；重放 100/100、1 唯一 hash；P2A PASS |
| `npm run test:performance` | 未单独跑 | 按任务要求（会重写证据）；S4 数字为准；本次 npm test 内含 performance 4/4 |
| `npm run verify:review-pack` / `verify:all` | 不存在 | T013 验收命令缺口（P2-01） |

## 四个 hash（冻结值；审查者用自写 Python 重算全部 MATCH）

| Hash | 值 |
|---|---|
| scenario_sha256 | `1ffb5f85561c6dd9f10fc15773097691c5c07fe20c6e9a001e231a41b61c9f22` |
| oracle_result_sha256 | `3502d81fa730605dd85548e39af6b7272015c026e65f91a2dae132c3e345a988` |
| analysis_sha256 | `4410d5c85cf5fe8ee858c4e01822cdbc1515c39afa7ba40d833aceb00a9576a4` |
| gate_sha256 | `651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52` |

S0_GATE.json 文件 SHA-256：`15b5c2d5b4f995ffa40979101b94c21f4565617152dfc8f9ebf9b0e53cd3572d`
（2,376 B；result PASS；replay 100/100；P2A PASS exit 0；externalRequests 0）。
T008 报告内嵌 canonical 对象的四个 hash 也已独立重算一致（analysis/gate 按设计不同于 S0）。

## Oracle 独立性

- Oracle 实现（target-capture / identity-compare / oracle-runner）独立于生产分类器；
  不读 golden、不向 DOM 注入 marker；24 个 privateTargetPath 无一出现在 fixture HTML 中；
  `data-testid`/`data-target`/`data-oracle` 0 命中。
- Golden 由 `T002_GOLDEN_DERIVATION.py` 手写推导（8 处修正已披露）；T002 实际 verdict
  与 golden 0 不一致。
- 三方 parity（生产分类器 vs 测试内独立重实现 vs golden）：192/192、0 mismatch
  （`evidence/s4/T011_ORACLE_PARITY.json`）。
- 结论：Oracle 独立性成立，无泄漏。

## 许可证

- 项目许可证：`PENDING_SAM_DECISION`（Sam 未决定）。
- 仓库无 LICENSE 文件；无任何文件擅自声称许可证；package.json 无 license 字段。
- 缺口（P2-20）：README / USER_GUIDE / HOW_TO_REPRODUCE / THIRD_PARTY_NOTICES /
  LICENSE_STATUS 均不存在；依赖许可清单无处可查（直接依赖 4 个，lockfile 共 76 个包）。

## 未解决项

P0 0 项，P1 0 项，P2 25 项，全部登记在 `unresolved_items.md`（含建议 FIX 任务包
FIX-P022-T013-01～10）。其中建议 T014 冻结前处理或确认接受：
P2-01（验收命令缺口）、P2-18（T012 报告数字复核）、P2-20（文档补齐）、P2-25
（校验器 depth-0 见证）；其余为已知局限，留待终审记录。

## 源码文件清单

### src/

| 文件 | 行数 | 字节数 | SHA-256 |
|---|---:|---:|---|
| `src/analysis/index.ts` | 12 | 344 | `9e128d5775bd7c0fe70240ae3c2cbae7194129f96173022db30b25f129e4f90a` |
| `src/analysis/witness.ts` | 611 | 22345 | `57fb95096df2eee546da8f4c21120b1d03de04e0fb268df36ac8df2dba1d4608` |
| `src/api/index.ts` | 22 | 612 | `bb64b7274f0edf738849f94c81324b672d0baa52aef4e268acfb520282db054a` |
| `src/api/node-shims.d.ts` | 42 | 1522 | `5cbb3b5b20b71fe57b00c2298671945c66afe034cd158d2b2e9c0d5c1cfe321e` |
| `src/api/routes.ts` | 190 | 6346 | `cc16a62d9393e1bc9df61944a452de0a6fa6d728e93ecfd085f900ea373e5e52` |
| `src/api/server.ts` | 175 | 5443 | `b955e5caaf8a1963da27c0adaa5f2b8933effdf5a29feccb57522de568d33aca` |
| `src/api/service.ts` | 496 | 16869 | `700246b0394c0386e5f04e33f43a01a87f37558d90ed887ecd74431b7f8e78d9` |
| `src/canonical/canonical-json.ts` | 127 | 5868 | `8e1d72f31c59c3fc28ffdf08c2d55b86fab57b783defa2e44e2fd047b4914b06` |
| `src/canonical/forbidden-scan.ts` | 220 | 6849 | `bba33d771c40a290690b9650868174b316153245a4c784bdc8d713d7f1f36f49` |
| `src/canonical/hashes.ts` | 437 | 14556 | `bf567d61077d66661f714788dd146b9471f736f9c2b0cbf9f3f507e4ba23f17b` |
| `src/canonical/index.ts` | 57 | 1133 | `83b849ee9e11c827ced176c14a8166cb9074078060da805ee8d603e5632db3e0` |
| `src/canonical/node-shims.d.ts` | 20 | 816 | `aa06b9e9ac71c1e7f1580ec7ad46481fe95611b19d8e130edcaf8c04f4bac8ee` |
| `src/contracts/locator.ts` | 166 | 4504 | `7207a6e91a93185531773d9fe90e5aa26206d334b67e854c4335a149aa5c195e` |
| `src/contracts/report.ts` | 476 | 16444 | `afddb16098f1040e06b7eca1f42270a07b126d79c359d552c02de53e477948d1` |
| `src/export/html-escape.ts` | 121 | 4518 | `2869088a748790fbbfc5f09fa3632c0ada339772ddf5dd4394b2b481bf809006` |
| `src/export/html-export.ts` | 202 | 10017 | `0e5a644c3950ff3f2cf68145e3717b0da075bc7bff7cb262e55f4e46d8ea5320` |
| `src/export/json-export.ts` | 122 | 4063 | `25cf84119dffc59c864f2505290bca844e1f17fb20f196c076a7d2abea91ffd7` |
| `src/export/node-shims.d.ts` | 11 | 538 | `1d0fa077080b7b829137ecbce82ae4c591dd83ce9475fee87e9fc0dfaf4494dd` |
| `src/export/templates/report.html.ts` | 81 | 4020 | `7b10e459f36662f32b51ab17536eecb6955b235e22d822e14712e7fbdad7af78` |
| `src/fixtures/fixture-loader.ts` | 106 | 2858 | `1bef5b9f0eb3f10dedbe14ac711db45d188793ccc9312bc1b41f4699d489d9e6` |
| `src/fixtures/fixture-manifest.ts` | 239 | 6824 | `fb99681e7b559431796675dfedf702ee624927740060d2cf043eb015efcf2607` |
| `src/fixtures/golden/expected-verdicts.json` | 1158 | 53561 | `fa80e27a30ef6109664c154453171b975a7c27b31149cef456fd8174dfee189b` |
| `src/fixtures/oracle-manifests/F001.json` | 14 | 335 | `f238ae36104a267a41dd22e9f4603e4b78cc5ed985721cdc2bc838904990a4e3` |
| `src/fixtures/oracle-manifests/F002.json` | 14 | 347 | `75fdd40839e0db813363ccaecf5d0a0e322d93824581c1c33fca821edca1e665` |
| `src/fixtures/oracle-manifests/F003.json` | 16 | 362 | `b539f9c547393bdd3dacd3db8d8dc4e98767122e36e58d98582f130073ca2cce` |
| `src/fixtures/oracle-manifests/F004.json` | 14 | 347 | `870d232d2fe38e7156611d33956702b736b3cbe4f150ac1a41b20d34b16285b1` |
| `src/fixtures/oracle-manifests/F005.json` | 14 | 346 | `9e78f77241b9524e2405007f57cef2f6e572b7f3a555a715ec9f4c10196d69bf` |
| `src/fixtures/oracle-manifests/F006.json` | 16 | 368 | `47d5c4db4b5d11dc2d6e525f9fbafbb3ee324fc92561f23bd6b2f42acbf9240c` |
| `src/fixtures/oracle-manifests/F007.json` | 14 | 326 | `535e44f796383f83a9f0896d3f7d27854be20a7c6eebb48c4685e74f3a70ddaf` |
| `src/fixtures/oracle-manifests/F008.json` | 14 | 331 | `d78723418a66d3fb22d83a1b40e9be14244698b66e26da2fd93e3efad2cc69ce` |
| `src/fixtures/oracle-manifests/F009.json` | 16 | 351 | `f694b08b7d60f95e0cac8c775921f464a4603896bcc5e93523eaa78b21a267ee` |
| `src/fixtures/oracle-manifests/F010.json` | 15 | 351 | `cea1f169e97c8b3b9b142075575484e28d5b8fb5a4681f11bdcaf3e8b733decf` |
| `src/fixtures/oracle-manifests/F011.json` | 14 | 352 | `7015f651c941513fbf8c99df8b8f4d6fa612bcb5860c03aac4cce3b34cc3dbbf` |
| `src/fixtures/oracle-manifests/F012.json` | 16 | 376 | `1330a6d32a8f91d2f064096ec0a779c999f8f7d72851c45c3e75afd10e74c379` |
| `src/fixtures/oracle-manifests/F013.json` | 14 | 385 | `7ce3a368614cf4fc5b54fee3664dd09727d4bfb65c43e40fb5c576733507fb60` |
| `src/fixtures/oracle-manifests/F014.json` | 15 | 391 | `af34967e0dbf8acc8eac13e043cf75a3d8b9b01c0c4f772b6b696d356049c6af` |
| `src/fixtures/oracle-manifests/F015.json` | 16 | 406 | `1adfeecea5d5b433ef1f952a7879e47bbdc8c87515b7ef25a5510711e5217682` |
| `src/fixtures/oracle-manifests/F016.json` | 15 | 357 | `f1f6c8c5df2e68e825d73512734da632c1792eb7ca19deb6e73bca0df5802a1e` |
| `src/fixtures/oracle-manifests/F017.json` | 14 | 357 | `ab02e45ca6905fe8c9224f9089ca3e0777bf5f2612576bdc0ecf612f910d30d7` |
| `src/fixtures/oracle-manifests/F018.json` | 16 | 364 | `8ee0ed9a81f7246dc45d986472e51f2a17fcbe2b55f00a791c02af69d8c5bfb7` |
| `src/fixtures/oracle-manifests/F019.json` | 15 | 361 | `69a36ccbd260e33a303443ffe03785c1dc063edb635308674206a843babe814f` |
| `src/fixtures/oracle-manifests/F020.json` | 15 | 366 | `5bcdd80f2fe24b7fa10bfe612762796b78bcd07e7ce13d31b8a2553bd3498691` |
| `src/fixtures/oracle-manifests/F021.json` | 18 | 425 | `f54bc27ced18b97cd3bb32ad1c6ace56957e06c51657684f96097128ac6f24f6` |
| `src/fixtures/oracle-manifests/F022.json` | 15 | 354 | `9ea23df3f934b1fbeec0df0765569b6cba0d1b748ae60017f6c67e9fdd0f596f` |
| `src/fixtures/oracle-manifests/F023.json` | 14 | 337 | `ffa839b5e904031c84789ad2c1fe9f4e16dff3bf626c2a80594a5a3e21a880c9` |
| `src/fixtures/oracle-manifests/F024.json` | 17 | 391 | `5d938b51cf324acdb7dd6e3e8eb88f2906148eb495d4c2913a3a28b648fb9038` |
| `src/fixtures/pages/F001.html` | 3 | 302 | `0e7eeb64239fbeaf1d02181aa405508b702396f22cabb594b4891ee1b99e837f` |
| `src/fixtures/pages/F002.html` | 3 | 302 | `b9a659e8e17b0408ae3fae6e05b4909f46ea0c202a5deee619b5d0958bf7441f` |
| `src/fixtures/pages/F003.html` | 3 | 327 | `54f795816c6ae628c9a80babed7abe202d8bd7265001011e98c843c03489c77f` |
| `src/fixtures/pages/F004.html` | 3 | 286 | `120e6277bcd64c99a351f0d9f93a41c1abe01cc03c3754024a8509c363ecc40b` |
| `src/fixtures/pages/F005.html` | 3 | 300 | `e8f6a63509d7c61da2b9039e8ec3e871aeb9643cf9600936064413a1fb2bd29e` |
| `src/fixtures/pages/F006.html` | 3 | 325 | `1cafbb9cbbffcc1d1066a6756fac7ea8108bcd358d3c60dbe243c4f6af99e3e7` |
| `src/fixtures/pages/F007.html` | 3 | 299 | `fe894249848fa597fce571372ac01c71d52aac125e9d24e07d44cf03a31e5b65` |
| `src/fixtures/pages/F008.html` | 3 | 299 | `08e4b0ade352019c72ee05921d545fe597fe03a01820cb3cbb8dab830792d473` |
| `src/fixtures/pages/F009.html` | 3 | 299 | `eff85b53afb7cdcd78ebaccd8f11a57f14fe256135b972750b457c71561bc43d` |
| `src/fixtures/pages/F010.html` | 3 | 306 | `f47c3a21b5f2dca3d194b67895ecb7b9283ddf7d9ff1005bb30745db261876ac` |
| `src/fixtures/pages/F011.html` | 3 | 306 | `fc2588b7c3f9ce73810b07629d42d70adb8137eb7f9f11fc82dc06639df6f7c3` |
| `src/fixtures/pages/F012.html` | 3 | 336 | `f2fc0fd0ae31495a9fb7eabc1ef2e8cfb28bdd1d5034146ce224761392b0d149` |
| `src/fixtures/pages/F013.html` | 3 | 374 | `1ac8847bbb43c634c6c7a9a8804e938cc0f1da6c6a2460b22256ccafc0140d12` |
| `src/fixtures/pages/F014.html` | 3 | 374 | `471356d4e945f8be18ab704e9bf499f5157aa902defb4ef8b04e5d066d573042` |
| `src/fixtures/pages/F015.html` | 3 | 374 | `930e005404499cd0363be6043fb015240e3610b739c4a81a581b611b0c2943fd` |
| `src/fixtures/pages/F016.html` | 3 | 295 | `9e5aed6feea657df70fe8115b3025086c3a1f5a10ed8648b05985dbc8cd38676` |
| `src/fixtures/pages/F017.html` | 3 | 318 | `0dd5f945623724211f7daa89167d8be88f4378698feadcd85298c9ac9f52c060` |
| `src/fixtures/pages/F018.html` | 3 | 295 | `f02350a4f36467132b727098dc3d9edc38650dca4c39e189f497597450de2333` |
| `src/fixtures/pages/F019.html` | 3 | 294 | `a69637928875b21da66d48ffb0ceb0a732650abccdbacf3a2d1b38b886506374` |
| `src/fixtures/pages/F020.html` | 3 | 294 | `1c91b9b982a9bf89a5701f065349b2c3987ac0512f49da1c895070c7b855cc5c` |
| `src/fixtures/pages/F021.html` | 3 | 367 | `a9118bc1be6fc08d907b8c58a30105b8021d1fd5cc7fc1a4377f8fca83da98f9` |
| `src/fixtures/pages/F022.html` | 3 | 300 | `88100ed1cd6e8f1e5fa4df7b2acf8005330fce6631f7fe714ae6aa0d5888d365` |
| `src/fixtures/pages/F023.html` | 3 | 313 | `410b1922d22d000fbeb72e9afbf85988ed67641ca8aa7364dd9fa7b3741ee247` |
| `src/fixtures/pages/F024.html` | 3 | 327 | `54490f1d0e2d3c12598bf5ce67a2a433d6bec4724ff385ea6550bba8c60dcc97` |
| `src/mutations/M01-wrap-target.ts` | 19 | 580 | `6ed94e7b141466bfd5c380f29e33dffa05fa580cce63e9d7dd6d6d96047bb0fc` |
| `src/mutations/M02-reorder-siblings.ts` | 20 | 690 | `7f4b23cec7dfb70ff6158bb7d11289afa509254020789eba808ab699abd32df4` |
| `src/mutations/M03-change-class.ts` | 14 | 486 | `ecf77aba71fb3886e64bd222d31cb87ac6091392125fa214942f835f7451d7e2` |
| `src/mutations/M04-insert-same-name.ts` | 27 | 905 | `803f15a9fbb55cfcd47a607479286b0ad8ee3256e8e10df9644dd64c592ba304` |
| `src/mutations/M05-nested-iframe.ts` | 31 | 1093 | `439166d89ca9167320157a49c03bd3a3ec652390b55eb69f2fdf47651f3b9724` |
| `src/mutations/M06-open-shadow-root.ts` | 20 | 687 | `c97e6b5f60b3be105a6b4812a0a5bb62fc26469444a570da6d4efb1f6838cb83` |
| `src/mutations/M07-hidden-duplicate.ts` | 29 | 992 | `ad2fcf52a5102c8f1ea3af618f0734d333cba961274df00d61eedec8f4361849` |
| `src/mutations/M08-change-text.ts` | 12 | 385 | `13000b3a18746859603f45874cc91ec5c485a016af57e1c14dcb90832ed429ef` |
| `src/mutations/index.ts` | 11 | 565 | `52b478f37812bb19577930af9b00eabcb10099626ebaebf5d5845e7db65ae0e8` |
| `src/mutations/registry.ts` | 36 | 1070 | `0d6f958a6829a11b53750feac0a56eca712474b9a2c59a2f30bb018fdb8dd79e` |
| `src/mutations/types.ts` | 24 | 604 | `8e3df5b04e567cc1295f39ccd7874af7c760ee2fb51f2fb4f73b54c23149ecd2` |
| `src/node-builtins.d.ts` | 17 | 666 | `eeda48723c9afd64fb091d7e623ca5a6b6025ca9488dc1607337999d3b08424a` |
| `src/oracle/identity-compare.ts` | 35 | 1329 | `91df6bac029fa9363c31077345fc521b7ddec795d7b3abc299f469daadc33f6a` |
| `src/oracle/oracle-runner.ts` | 81 | 1992 | `7bfec2c2e30396f607d14af5bb98c68726f6ebb700a121a48bd5ee4f32adeb4a` |
| `src/oracle/target-capture.ts` | 38 | 1297 | `591b6ea8e4516d3e3472de8c20778f80994a7eacc6e01f15e169874242e2a02d` |
| `src/runner/browser.ts` | 101 | 2164 | `7118b7a696d91d858d62b3801b7417b810a8777b1b852fb342192b2c525193f0` |
| `src/runner/execution.ts` | 16 | 427 | `4666276d965fd14c4f1731555036b22ea888e10beaed237b9cbc2425b0447d84` |
| `src/runner/frame-scope.ts` | 47 | 1055 | `be1c258ca018e7be1b275b1d4fbaae04fe25864324b3d41671e1eb0a24a02fa8` |
| `src/runner/locator-resolver.ts` | 188 | 5031 | `40026cdd19b191b2e1339ceeb883fc5b2eab2f19f4df507889adc40480b8c12e` |
| `src/score/stability-score.ts` | 480 | 16448 | `de82b8a342a40dc76e561f14d34421f22d94be661c90d5b1f0d7f3a39f9670b2` |
| `src/search/bfs.ts` | 302 | 11589 | `c54e4dfb6f95800699c5e619b7a4fae2f8bb8df30e192a032c81ac2eab261eea` |
| `src/search/browser-evaluator.ts` | 105 | 4226 | `fff399ddbe8e91f0bff9b81aeeaa1399501a806685915ec82e041112d148a630` |
| `src/search/index.ts` | 26 | 584 | `f996f5bad3f21568228b58f4cb251871b29b56fbcc16b2bdc3ed63234a8fcc16` |
| `src/search/state-key.ts` | 102 | 4190 | `8e5273c8fd30625eb1db536d8c717b1911b15e51a846422aa0ed245725cee80e` |
| `src/ui/app.js` | 920 | 39672 | `ea353228bcf4d26d73d50818fef782b5d4fc706170af3ed92e9ae4ba1f7f842c` |
| `src/ui/index.html` | 183 | 10649 | `7c640c1822693081b72d08417c2ddedbfb57e6f85a32ffbe917c977677025142` |
| `src/ui/node-shims.d.ts` | 16 | 670 | `5afd4c231a9e11df1ea75dc08ac09b1f2a5571729b8eb3aa8e6bed2c99e570c6` |
| `src/ui/server.ts` | 558 | 18080 | `ce143067cff21dbce1ec78d846b9b8644eea2fe83190c04f2d188129bbceb0c2` |
| `src/ui/snapshot.ts` | 146 | 4996 | `95d7481dea0535e7960573fbcc499f8a836da1c3002fd1234a6c5b1fc8bb7160` |
| `src/ui/styles.css` | 132 | 7205 | `5cd3e5d02038151de0f8a6c959dd45fc3cf622baf78f12bfbffe2a3f69a31345` |
| `src/verdict/classify.ts` | 165 | 5709 | `d591f24b1efb8072aa7dfb97d4458ff481a7decbfeeebfc653c368e4402b1850` |

### scripts/

| 文件 | 行数 | 字节数 | SHA-256 |
|---|---:|---:|---|
| `scripts/node-shims.d.ts` | 75 | 2503 | `a66b9139de5ebadce08f5f57da5ea410c56d0cd6f89bed5207014a167474e968` |
| `scripts/repeat-hash.ts` | 371 | 9976 | `6e2a6cd10317a01f9b10091dd2335edff394737b74f82f79678cb89e7c0364e3` |
| `scripts/s0-gate.ts` | 1348 | 41677 | `dfe87bcf1351e339391d064b6255d424281cf4740e9fe2c4910b02b08dd470c9` |
| `scripts/s0-locator-oracle.mjs` | 356 | 11008 | `78dc12938634cae39549e717737b7b82efdb7482317ae112e3cc618008557755` |
| `scripts/t008-api-report.ts` | 377 | 16763 | `a56296acbe72007779e1d99cafb4deee31d477f6f065db47ef96397bf6084703` |
| `scripts/t011-mutation-runner.mjs` | 669 | 29655 | `c10794dfb418f53d6b65667a7eb8462244da8f5392911f0099daf75a622e4911` |

### tests/

| 文件 | 行数 | 字节数 | SHA-256 |
|---|---:|---:|---|
| `tests/analysis/witness-boundaries.test.ts` | 163 | 5825 | `36996d0f4b3ea7952e5c8dea2e3939d1d9172f047ba76c7eeb059a3970f8e026` |
| `tests/analysis/witness.test.ts` | 250 | 9955 | `7363d953e86b82bab7fa97a11236fc1bad47a7d1c727e437b6647689b12adbcc` |
| `tests/api/analyze-browser.test.ts` | 197 | 7481 | `84b769c22d564b39ebd3bcca9bd8a9776f544d24ed40e3b7dfc780a6aad338a1` |
| `tests/api/routes-boundaries.test.ts` | 201 | 7704 | `478bd421b74c4a02f0f394c2dba5acbdc6f28cdecfad3c19498de00843cea32c` |
| `tests/api/routes.test.ts` | 251 | 9687 | `b2fd4aa7b386029fc7fdfb6103d343abf691ca58d6b212bef3ea6422015b05e9` |
| `tests/api/server.test.ts` | 99 | 3869 | `f81e7d7dd1977d69a4702630cac8d6f81113a2e93a721844f58c5f9e3ddfba4b` |
| `tests/api/validate-http.test.ts` | 112 | 4426 | `9305a901c9028eb7905ccf8d87b0329311eae21988202140f6b5969bbef64e66` |
| `tests/canonical/canonical-boundaries.test.ts` | 168 | 6732 | `534f6e122938b4517df344f1bfef373e9de9e51f4678daf6d2ec3ed3c0b03580` |
| `tests/canonical/canonical-json.test.ts` | 154 | 6660 | `d61da1d016bdec29dd16a7fcc19e6658b44fb08277dfbe5353c311c965ab7d36` |
| `tests/canonical/forbidden-scan.test.ts` | 119 | 4710 | `1cfbbfd0092dca25fca831d687abaef553adbfadf4e9d4d504581a19e3e3e20c` |
| `tests/canonical/hash-contract.test.ts` | 642 | 22423 | `1d84f16e79aa0ab089d904d2e6735ad086c2124a5990247b2dedf716b221dcac` |
| `tests/contracts/locator-spec.test.ts` | 266 | 9350 | `815c590802230c9b54f7f97321d82fc675bfc9c611e23dfb9f1ac51315f60317` |
| `tests/e2e/e2e-helpers.ts` | 176 | 5922 | `8fa65f4e244ca0a74bf4ed174aa72686df02e910377eba0c6787c8a4bc058353` |
| `tests/e2e/e2e-main-flow.test.ts` | 365 | 16610 | `0f34eaefe6eb8782aaa021e2bcf180e22d490f36f83f110a3866e3cb75ef010b` |
| `tests/e2e/offline.test.ts` | 244 | 10463 | `8bdf13c73437c22c2f6735b2f8b33fba9ca69858a529f6e579cf81ba8959093c` |
| `tests/e2e/performance.test.ts` | 348 | 15215 | `69a1b131b92fc2ee1e3bf78b01cbe49917ef1171276e81e136a4b4248979807b` |
| `tests/e2e/stress.test.ts` | 272 | 10525 | `0f3fcce883ee51e962533e2a4a846ebed004e76bcf64a9f68c1958dc79eae7b7` |
| `tests/export/html-escape.test.ts` | 145 | 6144 | `b03ba2fe2e1cfc96b9636c6fd3f8e8c8aaa920b061243ca9383b97a9440db756` |
| `tests/export/html-export.test.ts` | 136 | 6379 | `cf59d3a3532f17cbc074054348865f50df9e151808574f91c8c05c14e36fd773` |
| `tests/export/html-safety.test.ts` | 107 | 4333 | `65e8f73aaa1ae0aea594e7ba5d32f032b732b3ad8922538afcd4f21bc21d8cb3` |
| `tests/export/json-export.test.ts` | 116 | 5261 | `e4d644b91fc91865b79ef5c5afaa373cf03bc44525bb8ee5f08d2e09ce4c8615` |
| `tests/export/t010-helpers.ts` | 30 | 1255 | `e135028bf63289d6ca097ee67f3a5e3a8b745940aa1dbcd5b39f3f6acf928bbe` |
| `tests/integration/oracle-parity-independent.test.ts` | 265 | 10331 | `716599070b45ef4fa338a4f2d35202d0c979eb791ba38bcaf656ddd4f49e0eb6` |
| `tests/integration/p2a-detach-regression.test.ts` | 146 | 6046 | `b00db7283fa20e8219ab3ea403f622f7de71b109641f81dd813f93025f1c52a0` |
| `tests/integration/s0-fixtures.test.ts` | 116 | 3759 | `77b97514270dacf780851ea02c5cb865debdbf9ce0a050a4436e64e83f2f9b79` |
| `tests/integration/s0-helpers.ts` | 56 | 1551 | `ebc0bd63f7895ae34963f069bac00f06bd275f3f088c168123fb6f673bc17eac` |
| `tests/integration/s0-mutations.test.ts` | 256 | 8718 | `cd26fcc2585ff442ffac1891dd215cd913889d0c4c0f5aacbcdd035d079c6703` |
| `tests/mutations/mutation-operators.test.ts` | 281 | 12696 | `4a248d04453e5d9268134432ac74e84df2c7276be84cf5a1d78f29c8943543b2` |
| `tests/oracle/oracle-capture.test.ts` | 268 | 11898 | `f01a57128f047d5ec226a060c944595f398daa89bcd8533977d2c2ca68370ef6` |
| `tests/property/property.test.ts` | 246 | 11018 | `a67b8d78e48a8df1a9c2a4d4283f4103389aa7913fb5a68ddd5d9e3690967c4e` |
| `tests/runner/resolver-boundaries.test.ts` | 325 | 12239 | `1440b498ec49f88d65eaf462e07eda9071536bfff0228211bdb3fdad0ecebc0c` |
| `tests/score/controls.test.ts` | 488 | 20781 | `a1bfcc78c566613a2de09356aac42916f236cc0aa0bd51a486c8ed3177ef1d4b` |
| `tests/score/format-percent-boundaries.test.ts` | 267 | 10152 | `97d7182d6af7bef38dcbd0d5061f3a0b5f80b5bc36e21e68a0c73fd1544da6f2` |
| `tests/score/stability-score.test.ts` | 435 | 18177 | `160e6f238420772a9b8b27ce2d9745be76efd5db6f0d42c52dcec4acee9db1d3` |
| `tests/search/bfs-browser.test.ts` | 236 | 8901 | `1426aa3453c2ef964a98d66f278b2718ea71cc1334f182d94451d0188b8906b2` |
| `tests/search/bfs-determinism.test.ts` | 149 | 5729 | `62ff6417199b4171d6d6f8861f80221a46976e0c2030a6698c13e227aee4836d` |
| `tests/search/bfs.test.ts` | 382 | 14373 | `9a8390db823de9ce6a6e819af62b6ba61f8a8c98cb695bcce75077aa038314e0` |
| `tests/search/state-key-boundaries.test.ts` | 135 | 4800 | `1c2d153acc7da8dc6ed1808fc448d0380d6aab44d360c96a0365c97fbc66f76e` |
| `tests/t008-helpers.ts` | 128 | 3968 | `68a96350db3a0860e8995431c1836085136f5aca815fd305aa76d7ec05117196` |
| `tests/ui/ui-flow.test.ts` | 293 | 13407 | `a8509641fbab726df412e474aff0576acbae20e005a54ecd720f2e76db266383` |
| `tests/verdict/classify-boundaries.test.ts` | 212 | 8193 | `f160e9e9278f007c534d63c5d30d7bb843da82e5d7911a34d2350b1ecf95075e` |
| `tests/verdict/classify.test.ts` | 418 | 12266 | `a22d378fa1cc01149b475313b22fd8ea82568d83fc1160d1b388d9b3049923f6` |
| `tests/verdict/verdict-golden.test.ts` | 348 | 13106 | `4dfc94327268c97335da79df819f2f2406365a75085d98dc96c90dcdb1dc9d58` |
