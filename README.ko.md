# xslt-bridge

브라우저에서 XSLT가 사라진 뒤에도 쓸 수 있도록, 내장 `XSLTProcessor`(XSLT 1.0 / XPath 1.0)를 그대로 대체하는 순수 JavaScript 구현입니다.
최신 브라우저 어디서나 동작하고, **크롬 내장 `XSLTProcessor`와 같은 결과**를 냅니다.
WebAssembly와 외부 의존성이 없고, ES5 문법이며, gzip 기준 약 29KB입니다.

[English README](README.md)

## 왜 필요한가

브라우저들이 XSLT(`XSLTProcessor`와 `<?xml-stylesheet type="text/xsl"?>`)를 제거하고 있습니다.

- **크롬**은 일정이 확정되어 있습니다([Chrome for Developers](https://developer.chrome.com/docs/web-platform/deprecating-xslt), [Chrome Platform Status](https://chromestatus.com/feature/4709671889534976)). 아래 표 참고.
- **Edge**는 Chromium 기반이라 크롬을 따라갑니다. Edge 147에서 테스트와 전환용 임시 정책 `XSLTEnabled`가 추가됐습니다([Microsoft Learn](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/xsltenabled)).
- **Firefox**(Gecko)와 **Safari**(WebKit)도 XSLT 제거 계획을 밝혔습니다. 날짜는 아직 발표되지 않았습니다.

| 크롬 | 날짜 | 내용 |
|---|---|---|
| 143 | 2025년 12월 2일 | 콘솔에 지원 중단 경고 |
| 146 | 2026년 3월 10일 | 기업 정책 제공 (임시 유예) |
| 152 | 2026년 8월 25일 | 오리진 트라이얼 제공 (임시 유예) |
| 158 | 2026년 11월 17일 | 안정 버전에서 XSLT 동작 중지 (유예 대상 제외) |
| 176 | 2027년 8월 17일 | 유예 종료, 모든 사용자에게서 XSLT 비활성화 |

업무용 웹 애플리케이션 중에는 그리드나 트리를 그리려고 JavaScript에서 `XSLTProcessor`를 호출하는 경우가 많습니다.
xslt-bridge를 쓰면 이런 애플리케이션을 다시 작성하지 않고, 스크립트 하나만 추가해서 제거 이후에도 모든 브라우저에서 계속 동작하게 할 수 있습니다.

이 프로젝트는 기존 서비스를 유지하면서 XSLT 제거에 대응해야 했던 유지보수 담당자가 만들었습니다. 서버 사이드 변환이나 JSON으로 옮기는 것이 장기적인 방향이지만, xslt-bridge는 그런 재작성 없이 지금의 서비스를 계속 동작시켜야 하는 팀을 위한 것입니다.

## 브라우저 지원

- `DOMParser`, `XMLSerializer`, `document.implementation`, `Intl.Collator`가 있는 브라우저면 동작합니다. 현재의 크롬, Edge, Firefox, Safari가 해당합니다. ES5 코드이고 WebAssembly나 `eval`을 쓰지 않습니다.
- 결과는 어느 브라우저에서나 크롬과 같습니다. Firefox와 Safari는 자체 XSLT 엔진을 쓰므로, 기본 엔진 결과와 공백·정렬 순서·HTML 결과 파싱 같은 세부가 다를 수 있습니다. 두 브라우저에 아직 XSLT가 있는 동안은 기본 엔진을 유지하는 `fallback` 모드나, 차이를 먼저 확인하는 `compare` 모드를 쓰세요.
- 자동 테스트는 Node.js와 jsdom에서 돌립니다. `selftest/index.html`은 연 브라우저 안에서 엔진을 검사하므로, 대상 브라우저마다 열어 확인하세요. Firefox·Safari 결과 제보를 환영합니다.

## 빠른 시작

`XSLTProcessor`를 쓰는 코드보다 먼저 스크립트를 로드합니다(`defer`/`async` 없이).

```html
<script src="https://cdn.jsdelivr.net/npm/xslt-bridge@1/dist/xslt-bridge.min.js"></script>
```

또는 `npm install xslt-bridge`로 설치해서 `dist/xslt-bridge.min.js`를 서비스하거나, 번들링하는 애플리케이션이면 `import 'xslt-bridge'`를 씁니다.

기존 코드는 고칠 필요가 없습니다.

```js
var processor = new XSLTProcessor();            // 이제 XsltBridge 인스턴스
processor.importStylesheet(xslDoc);
processor.setParameter(null, 'sortBy', 'name');
var fragment = processor.transformToFragment(xmlDoc, document);
```

`examples/without-engine.html`과 `examples/with-engine.html`은 같은 페이지를 스크립트 없이/있게 만든 예제입니다.

## 동작 모드

스크립트를 로드하기 전에 `window.XSLT_BRIDGE_MODE`를 지정합니다.

| 모드 | 동작 |
|---|---|
| `replace` (기본) | 항상 이 엔진을 씁니다. 브라우저 기본 생성자는 건드리지 않고 `window.XSLTProcessorNative`로 접근할 수 있게 둡니다. |
| `fallback` | 브라우저 기본 `XSLTProcessor`가 있는 동안은 그것을 쓰고, 없어진 뒤에 이 엔진을 씁니다. XSLT가 아직 있는 Firefox·Safari에 적합합니다. |
| `compare` | 화면에는 기본 처리기 결과를 쓰고, 이 엔진도 함께 실행해 결과가 다르면 `console.warn`으로 알립니다. 전환 전에 애플리케이션을 검증할 때 씁니다. |
| `none` | 아무것도 설치하지 않습니다. `new XsltBridge()`로 직접 씁니다. |

## API

표준 `XSLTProcessor` 메서드: `importStylesheet`, `transformToFragment`, `transformToDocument`, `setParameter`, `getParameter`, `removeParameter`, `clearParameters`, `reset`.

추가 기능:

- `transformToString(source)`: 크롬이 파싱하기 직전에 만드는 것과 똑같은 직렬화 결과 문자열을 돌려줍니다.
- `XsltBridge.loadDocument = function (url) { return xmlDocument; }`: `xsl:include`, `xsl:import`, `document()`가 쓰는 로더를 바꿉니다. 기본 로더는 동기 `XMLHttpRequest`를 씁니다.
- `XsltBridge.version`, 그리고 엔진이 설치된 동안 `XSLTProcessor.isXsltBridge === true`.

크롬과 마찬가지로 변환이 실패하면 `transformToFragment`와 `transformToDocument`는 `null`을 돌려주고, 원인은 `console.error`로 남깁니다(`[xslt-bridge] transformation failed: ...`).

## 크롬과 얼마나 같은가

크롬의 `XSLTProcessor`는 libxslt·libxml2와 그 위의 얇은 Blink 계층으로 되어 있습니다. 두 부분을 모두 재현했습니다.

libxslt 1.1.45와 libxml2 2.16.0에서 규칙 단위로 옮긴 것: 숫자→문자열 변환, `format-number`, `xsl:number`, 템플릿 우선순위와 import 우선순위, `key()`, attribute-set 병합 순서, 네임스페이스 정리, 공백 제거, HTML/XML/텍스트 직렬화(HTML 요소 표, 인라인·빈 요소, URI 이스케이프, `<meta charset>`, DOCTYPE), 그리고 어떤 오류에서 변환이 실패하고 어떤 오류는 경고만 하는지.

Blink에서 가져온 것(Chromium 소스로 확인). 그래서 어느 브라우저에서나 같은 결과가 나옵니다.

- HTML 문서를 대상으로 한 `transformToFragment`는 `html` 출력 방식을 적용하고, 결과를 body 문맥에서 파싱합니다(예: 표에 `tbody`가 들어감).
- XML 선언은 항상 생략하고, 마지막 줄바꿈 1개를 제거합니다.
- `xsl:sort`의 텍스트 비교는 ICU 정렬(로캘 `en`, 대문자 우선, `lang`·`case-order` 반영)이며, `Intl.Collator`로 구현했습니다.
- 확장 함수는 `exsl:node-set` 하나뿐입니다.
- 텍스트 출력을 `transformToDocument`로 받으면 `<pre>`를 가진 XHTML 문서로 감쌉니다.
- 변환할 때마다 스타일시트를 다시 읽으므로, 이후 스타일시트 DOM을 바꾸면 다음 변환에 반영됩니다.

## 검증

`tools/oracle/blinkxslt.c`는 크롬의 `XSLTProcessor`와 같은 방식으로 libxslt 1.1.45와 libxml2 2.16.0(ICU 포함)을 구동합니다. 그 결과를 `test/cases/*/expected.json`에 저장해 두었습니다.

테스트 케이스 132개는 XSLT·XPath 기능, 출력 방식, 정렬, 번호 매기기, 네임스페이스, 오류 동작을 다룹니다. 각 케이스는 두 경로에서 검사합니다. 직렬화된 결과를 바이트 단위로 비교하고, `transformToFragment(xml, document)`가 만든 DOM을 비교합니다. 두 빌드 모두 전 케이스를 통과합니다(`npm test`).

크롬 버전마다 들어 있는 libxml2/libxslt가 기준 버전과 조금 다를 수 있습니다. `selftest/index.html`은 브라우저에 기본 `XSLTProcessor`가 남아 있는 동안 그것과 이 엔진의 결과를 비교합니다.

## WebAssembly 폴리필과 비교

크롬 팀의 [xslt_polyfill](https://github.com/mfreed7/xslt_polyfill)은 libxslt를 WebAssembly로 컴파일한 것으로, 많은 사이트에 좋은 첫 선택입니다.
2026-09-22에 xslt-polyfill 1.0.29를 같은 132개 케이스로 측정한 결과입니다(Node 22 + jsdom).

| | xslt-bridge | xslt-polyfill (WASM) |
|---|---|---|
| 크롬 절차와 DOM 일치 | 132 / 132 | 113 / 132 (텍스트만 같음 6개 추가) |
| 동기 API에서 `xsl:include` / `xsl:import` / `document()` | 동작 (동기 XHR) | 실패 (리소스를 비동기로 가져옴) |
| 스크립트 로드 직후 동기 호출 | 동작 | `xsltPolyfillReady()`가 끝날 때까지 예외 |
| HTML 문서 대상일 때 `html` 출력 방식 적용 | 예 | 아니오 |
| 크기 (gzip) | 29KB | 520KB + WebAssembly 메모리 (프로젝트 이슈 기준 초기 32MB) |
| WebAssembly 필요 (CSP에서 `wasm-unsafe-eval`) | 불필요, `eval`도 쓰지 않음 | 필요 |
| 엔진 코어 | 새로 작성한 코드 | libxslt 자체 |

libxslt 자체, 즉 가장 오래 검증되고 upstream에서 유지보수되는 코어를 원하고 위 표의 항목에 해당하지 않는다면 폴리필을 권합니다.
xslt-bridge는 `XSLTProcessor`를 동기로 호출하거나, `xsl:include`/`xsl:import`를 쓰거나, 프레임을 많이 쓰거나, WebAssembly를 쓸 수 없는 레거시 애플리케이션을 위한 것입니다.

## 성능

`bench/bench.js`는 3000행×15열 표를 정렬 키 2개와 모든 셀의 `format-number`로 변환합니다. Node 22 + jsdom에서 한 번에 약 0.4~0.8초입니다.
기본 libxslt로는 같은 변환이 약 0.1초입니다. 브라우저 DOM은 jsdom보다 훨씬 빠르지만, 아주 큰 표는 기본 엔진보다 느릴 수 있습니다.

재귀: 기본 V8 스택에서 재귀 이름 템플릿 약 1,800단계까지 동작합니다. libxslt는 중첩 3,000단위에서 멈추며, 같은 템플릿 기준 약 1,500단계입니다.

## 큰 레거시 애플리케이션에 적용하기

모든 페이지나 프레임에 스크립트 태그를 넣기 어려울 때:

1. `XSLTProcessor`를 호출하는 공통 스크립트 맨 앞에 `dist/xslt-bridge.min.js`를 붙입니다. 여러 번 로드되어도 한 번만 설치되므로 안전하고, 배포 파일은 ASCII 전용이라 어떤 인코딩의 스크립트와 이어 붙여도 됩니다.
2. 합친 공통 스크립트를 웹 서버에서 대신 서비스합니다(예: Apache `Alias`와 `ProxyPass` 제외). 애플리케이션 파일은 건드리지 않습니다.
3. 리버스 프록시에서 HTML 응답에 스크립트 태그를 주입합니다(예: Apache `mod_substitute`).

`replace` 모드에서는 엔진이 동작하는 곳에서 크롬의 "XSLT 지원 중단" 경고가 사라집니다. 경고가 남아 있으면 그 소스 위치가 아직 기본 `XSLTProcessor`를 쓰는 코드를 가리킵니다. 보통 스크립트를 로드하지 않는 프레임이거나 캐시된 옛 파일입니다. 그 프레임의 콘솔에서 `XSLTProcessor.isXsltBridge`를 보면 어느 쪽이 쓰이는지 알 수 있습니다.

## 제한 사항

- 브라우저와 마찬가지로 XSLT 1.0만 지원합니다. EXSLT는 크롬과 마찬가지로 `exsl:node-set`만 지원합니다.
- `xsl:include`, `xsl:import`, `document()`는 동기 `XMLHttpRequest`를 쓰므로, 크롬 콘솔에 동기 XHR에 대한 일반 안내가 나옵니다.
- DOM(`DOMParser`, `XMLSerializer`, `document.implementation`)이 필요합니다. Node.js에서는 테스트처럼 jsdom 창 안에서 스크립트를 실행하세요. `require()`만 하면 클래스만 돌려줍니다.
- 기준 버전은 libxml2 2.16.0과 libxslt 1.1.45입니다. 오래된 크롬 빌드에서는 HTML 공백 위치가 일부 다를 수 있습니다.

## 개발

```
npm install
npm run build       # dist/xslt-bridge.js (가독판), dist/xslt-bridge.min.js
npm test            # 132개 케이스 × 2경로 + API 테스트, 두 빌드 모두
npm run selftest    # selftest/index.html 재생성
npm run bench
```

- `src/`: 엔진을 8개 파일로 나눈 것이며, `scripts/build.js`가 순서대로 합칩니다. 코드 주석은 한국어이고, 메시지와 문서는 영어입니다.
- `test/cases/<케이스>/`: `in.xml`, `t.xsl`, 선택적으로 `params.txt`와 추가 파일, 그리고 `expected.json`.
- `tools/oracle/`: 기준 변환기와 `expected.json` 재생성 스크립트(해당 폴더의 README 참고).

## 라이선스

[MIT](LICENSE). 일부는 libxml2와 libxslt(MIT 계열 라이선스)에서 파생되었습니다. [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)를 참고하세요.
