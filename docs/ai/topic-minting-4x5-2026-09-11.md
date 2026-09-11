# Topic minting: 4 models x 5 cards (2026-09-11)

Set: Accounting - "Talking". Same prompt, same KLPs, one call per card per model. DRY RUN, nothing written.


## Walk me through the 3 financial statements & how they generally work

### gemini-3.6-flash
- **parent:** three financial statements
- **leaves (5):**
  - income statement purpose  ← KLP 0
  - non-cash expense add-backs  ← KLP 2
  - net change in cash calculation  ← KLP 3
  - balance sheet snapshot concept  ← KLP 4
  - fundamental accounting equation  ← KLP 5
- **relations (3):**
  - net income —precedes→ cash flow statement  ← KLP 1
  - net income —precedes→ retained earnings  ← KLP 6
  - ending cash balance —precedes→ current assets  ← KLP 7
- **contexts:** non-cash adjustments (KLP 2); working capital changes (KLP 3)
- **coverage:** 8 KLP refs covered

### gemini-3.5-flash
- **parent:** financial statement integration
- **leaves (5):**
  - net income  ← KLP 0
  - depreciation  ← KLP 2
  - net change in cash  ← KLP 3
  - balance sheet snapshot  ← KLP 4
  - accounting equation  ← KLP 5
- **relations (3):**
  - net income —precedes→ operating cash flow  ← KLP 1
  - net income —precedes→ retained earnings  ← KLP 6
  - ending cash balance —precedes→ cash and cash equivalents  ← KLP 7
- **contexts:** non-cash adjustments (KLP 1); non-cash adjustments (KLP 2); working capital changes (KLP 3)
- **coverage:** 8 KLP refs covered

### gemini-3.1-flash-lite
- **parent:** financial statements linkage
- **leaves (6):**
  - income statement  ← KLP 0  ⚠ container
  - cash flow statement  ← KLP 3  ⚠ container
  - balance sheet  ← KLP 4  ⚠ container
  - accounting equation  ← KLP 5
  - depreciation  ← KLP 2
  - net income  ← KLP 1
- **relations (2):**
  - net income —precedes→ retained earnings  ← KLP 6
  - cash flow statement —precedes→ balance sheet  ← KLP 7
- **contexts:** non-cash adjustments (KLP 2); working capital changes (KLP 3)
- **coverage:** 8 KLP refs covered

### deepseek-v4-flash
- **parent:** three-statement financial model
- **leaves (6):**
  - income statement profitability  ← KLP 0
  - net income as cash flow starting point  ← KLP 1
  - non-cash expense add-backs  ← KLP 2
  - cash flow statement adjustments  ← KLP 3
  - balance sheet snapshot  ← KLP 4
  - accounting equation  ← KLP 5
- **relations (2):**
  - net income —precedes→ retained earnings  ← KLP 6
  - net change in cash —precedes→ cash and cash equivalents  ← KLP 7
- **contexts:** non-cash adjustments (KLP 1); non-cash adjustments (KLP 2); operating cash flow (KLP 3); financing cash flow (KLP 3); capital expenditures (KLP 3); working capital changes (KLP 3); retained earnings rollforward (KLP 6); cash and cash equivalents (KLP 7)
- **coverage:** 8 KLP refs covered


## How do the three statements link together?

### gemini-3.6-flash
- **parent:** three-statement linkages
- **leaves (0):**
- **relations (6):**
  - net income —precedes→ retained earnings  ← KLP 0
  - net income —precedes→ operating cash flow  ← KLP 1
  - working capital changes —applies_within→ operating cash flow  ← KLP 2
  - investing cash flow —applies_within→ long-term assets  ← KLP 3
  - financing cash flow —applies_within→ debt  ← KLP 4
  - net change in cash —precedes→ ending cash balance  ← KLP 5
- **contexts:** equity rollforward (KLP 0); operating cash flow (KLP 1); working capital adjustments (KLP 2); investing cash flow (KLP 3); financing cash flow (KLP 4); cash rollforward (KLP 5)
- **coverage:** 6 KLP refs covered

### gemini-3.5-flash
- **parent:** three-statement integration
- **leaves (1):**
  - cash reconciliation  ← KLP 5
- **relations (5):**
  - net income —precedes→ retained earnings  ← KLP 0
  - net income —precedes→ operating cash flow  ← KLP 1
  - operating working capital —precedes→ operating cash flow  ← KLP 2
  - long-term assets —causes→ investing cash flow  ← KLP 3
  - debt and equity —causes→ financing cash flow  ← KLP 4
- **contexts:** equity rollforward (KLP 0); indirect cash flow method (KLP 1); working capital adjustments (KLP 2); investing cash flow (KLP 3); financing cash flow (KLP 4); cash reconciliation (KLP 5)
- **coverage:** 6 KLP refs covered

### gemini-3.1-flash-lite
- **parent:** financial statement linkages
- **leaves (5):**
  - net income  ← KLP 1
  - operating working capital  ← KLP 2
  - long-term assets  ← KLP 3
  - debt and equity transactions  ← KLP 4
  - cash balance  ← KLP 5
- **relations (1):**
  - net income —precedes→ retained earnings  ← KLP 0
- **contexts:** operating cash flow (KLP 1); non-cash adjustments (KLP 2); investing cash flow (KLP 3); financing cash flow (KLP 4)
- **coverage:** 6 KLP refs covered

### deepseek-v4-flash
- **parent:** three-statement linkage
- **leaves (5):**
  - net income to operating cash flow  ← KLP 1
  - working capital adjustments  ← KLP 2
  - investing cash flow  ← KLP 3
  - financing cash flow  ← KLP 4
  - cash reconciliation  ← KLP 5
- **relations (1):**
  - net income —precedes→ retained earnings  ← KLP 0
- **contexts:** operating cash flow (KLP 1); working capital changes (KLP 2); investing cash flow (KLP 3); financing cash flow (KLP 4); cash rollforward (KLP 5); equity rollforward (KLP 0)
- **coverage:** 6 KLP refs covered


## Give me more details on assets, liabilities, and equity

### gemini-3.6-flash
- **parent:** balance sheet components
- **leaves (4):**
  - accounting equation  ← KLP 0
  - assets  ← KLP 1
  - liabilities  ← KLP 2
  - equity  ← KLP 3
- **relations (1):**
  - capital structure —causes→ assets  ← KLP 4
- **coverage:** 5 KLP refs covered

### gemini-3.5-flash
- **parent:** balance sheet components
- **leaves (4):**
  - accounting equation  ← KLP 0
  - assets  ← KLP 1
  - liabilities  ← KLP 2
  - equity  ← KLP 3
- **relations (1):**
  - capital structure —causes→ assets  ← KLP 4
- **coverage:** 5 KLP refs covered

### gemini-3.1-flash-lite
- **parent:** financial position
- **leaves (4):**
  - accounting equation  ← KLP 0
  - assets  ← KLP 1
  - liabilities  ← KLP 2
  - equity  ← KLP 3
- **relations (2):**
  - liabilities —causes→ assets  ← KLP 4
  - equity —causes→ assets  ← KLP 4
- **contexts:** liability settlement (KLP 2); equity rollforward (KLP 3)
- **coverage:** 5 KLP refs covered, DOUBLE-covered: 4

### deepseek-v4-flash
- **parent:** balance sheet structure
- **leaves (4):**
  - accounting equation  ← KLP 0
  - assets  ← KLP 1
  - liabilities  ← KLP 2
  - equity  ← KLP 3
- **relations (2):**
  - liabilities —causes→ assets  ← KLP 4
  - equity —causes→ assets  ← KLP 4
- **contexts:** double-entry bookkeeping (KLP 0); future economic benefits (KLP 1); external claims on assets (KLP 2); equity rollforward (KLP 3)
- **coverage:** 5 KLP refs covered, DOUBLE-covered: 4


## Walk me through the cash flow statement

### gemini-3.6-flash
- **parent:** cash flow statement structure
- **leaves (4):**
  - cash flow statement sections  ← KLP 0
  - operating working capital adjustments  ← KLP 2
  - investing cash flow  ← KLP 3
  - financing cash flow  ← KLP 4
- **relations (2):**
  - non-cash expenses —applies_within→ operating cash flow  ← KLP 1
  - net change in cash —confused_with→ free cash flow  ← KLP 5
- **contexts:** non-cash adjustments (KLP 1); working capital changes (KLP 2); capital expenditures (KLP 3); capital raising and return (KLP 4)
- **coverage:** 6 KLP refs covered

### gemini-3.5-flash
- **parent:** cash flow analysis
- **leaves (5):**
  - cash flow statement structure  ← KLP 0
  - non-cash expense add-backs  ← KLP 1
  - operating working capital changes  ← KLP 2
  - capital expenditures  ← KLP 3
  - financing cash flow activities  ← KLP 4
- **relations (1):**
  - net change in cash —confused_with→ free cash flow  ← KLP 5
- **contexts:** non-cash adjustments (KLP 1); working capital adjustments (KLP 2); investing activities (KLP 3); financing activities (KLP 4); free cash flow calculation (KLP 5)
- **coverage:** 6 KLP refs covered

### gemini-3.1-flash-lite
- **parent:** cash flow analysis
- **leaves (6):**
  - cash flow statement sections  ← KLP 0
  - non-cash expense add-backs  ← KLP 1
  - operating working capital changes  ← KLP 2
  - capital expenditures  ← KLP 3
  - financing cash flow  ← KLP 4
  - free cash flow  ← KLP 5
- **relations (2):**
  - free cash flow —requires→ operating cash flow  ← KLP 5
  - capital expenditures —requires→ free cash flow  ← KLP 5
- **contexts:** non-cash adjustments (KLP 1); working capital changes (KLP 2); investing cash flow (KLP 3); financing cash flow (KLP 4)
- **coverage:** 6 KLP refs covered, DOUBLE-covered: 5

### deepseek-v4-flash
- **parent:** cash flow statement
- **leaves (6):**
  - three-section cash flow structure  ← KLP 0
  - non-cash expense add-backs  ← KLP 1
  - operating working capital adjustments  ← KLP 2
  - capital expenditures  ← KLP 3
  - financing cash flow transactions  ← KLP 4
  - net change in cash  ← KLP 5
- **relations (1):**
  - operating cash flow —requires→ free cash flow  ← KLP 5
- **contexts:** operating cash flow (KLP 1); working capital changes (KLP 2); investing cash flow (KLP 3); financing cash flow (KLP 4); operating cash flow (KLP 5); free cash flow (KLP 5)
- **coverage:** 6 KLP refs covered, DOUBLE-covered: 5


## Walk me through the income statement

### gemini-3.6-flash
- **parent:** income statement line items
- **leaves (4):**
  - gross profit  ← KLP 0
  - operating expenses  ← KLP 1
  - earnings before interest and taxes  ← KLP 2
  - net income  ← KLP 4
- **relations (1):**
  - earnings before interest and taxes —precedes→ earnings before interest taxes depreciation and amortization  ← KLP 3
- **contexts:** direct profitability (KLP 0); overhead allocation (KLP 1); operating profit calculation (KLP 2); non-cash adjustments (KLP 3); bottom-line profit calculation (KLP 4)
- **coverage:** 5 KLP refs covered

### gemini-3.5-flash
- **parent:** income statement structure
- **leaves (4):**
  - gross profit  ← KLP 0
  - operating expenses  ← KLP 1
  - earnings before interest and taxes  ← KLP 2
  - net income  ← KLP 4
- **relations (1):**
  - earnings before interest and taxes —precedes→ earnings before interest taxes depreciation and amortization  ← KLP 3
- **contexts:** non-cash adjustments (KLP 3); interest and tax allocation (KLP 4)
- **coverage:** 5 KLP refs covered

### gemini-3.1-flash-lite
- **parent:** income statement analysis
- **leaves (4):**
  - gross profit  ← KLP 0
  - operating expenses  ← KLP 1
  - earnings before interest and taxes  ← KLP 2
  - net income  ← KLP 4
- **relations (1):**
  - earnings before interest and taxes —causes→ earnings before interest taxes depreciation and amortization  ← KLP 3
- **contexts:** non-cash accounting charges (KLP 3)
- **coverage:** 5 KLP refs covered

### deepseek-v4-flash
- **parent:** income statement structure
- **leaves (4):**
  - gross profit  ← KLP 0
  - operating expenses  ← KLP 1
  - ebit  ← KLP 2
  - net income  ← KLP 4
- **relations (1):**
  - ebit —precedes→ ebitda  ← KLP 3
- **contexts:** cost of goods sold (KLP 0); depreciation and amortization allocation (KLP 1); operating profit derivation (KLP 2); non-cash adjustments (KLP 3); bottom-line derivation (KLP 4)
- **coverage:** 5 KLP refs covered


## Per-model tallies

| model | cards ok | leaves | leaves/card | KLPs/leaf | relations | container leaves | contexts |
|---|---|---|---|---|---|---|---|
| gemini-3.6-flash | 5/5 | 17 | 3.4 | 1.00 | 13 | 0 | 17 |
| gemini-3.5-flash | 5/5 | 19 | 3.8 | 1.00 | 11 | 0 | 16 |
| gemini-3.1-flash-lite | 5/5 | 25 | 5.0 | 1.00 | 8 | 3 | 13 |
| deepseek-v4-flash | 5/5 | 25 | 5.0 | 1.00 | 7 | 0 | 29 |

## Cross-model agreement

Leaf names minted by >=2 models for the SAME card (exact match after normalization). A name several models reach independently is evidence the name is canonical; a name only one model produced is suspect.

- **Walk me through the 3 financial statements & how they genera** — 5 shared of 16 distinct: accounting equation (3); noncash expense addbacks (2); net income (2); depreciation (2); balance sheet snapshot (2)
- **How do the three statements link together?** — 1 shared of 10 distinct: cash reconciliation (2)
- **Give me more details on assets, liabilities, and equity** — 4 shared of 4 distinct: accounting equation (4); assets (4); liabilities (4); equity (4)
- **Walk me through the cash flow statement** — 6 shared of 13 distinct: noncash expense addbacks (3); capital expenditures (3); cash flow statement sections (2); operating working capital adjustments (2); financing cash flow (2); operating working capital changes (2)
- **Walk me through the income statement** — 4 shared of 5 distinct: gross profit (4); operating expenses (4); net income (4); earnings before interest and taxes (3)

Relation triples (from, type, to) produced by >=2 models for the same card:

- **Walk me through the 3 financial statements & how they genera** — 1 shared of 7: net income —precedes→ retained earnings (4)
- **How do the three statements link together?** — 2 shared of 9: net income —precedes→ retained earnings (4); net income —precedes→ operating cash flow (2)
- **Give me more details on assets, liabilities, and equity** — 3 shared of 3: capital structure —causes→ assets (2); liabilities —causes→ assets (2); equity —causes→ assets (2)
- **Walk me through the cash flow statement** — 1 shared of 5: net change in cash —confused_with→ free cash flow (2)
- **Walk me through the income statement** — 1 shared of 3: earnings before interest and taxes —precedes→ earnings before interest taxes depreciation and amortization (2)

All relation endpoints, with which models named the concept anywhere (leaf, context or endpoint) across the 5 cards:

Concept names used by >=2 models (34 of 76 distinct): noncash expense addbacks (4); noncash adjustments (4); working capital changes (4); net income (4); retained earnings (4); equity rollforward (4); operating cash flow (4); investing cash flow (4); financing cash flow (4); accounting equation (4); assets (4); liabilities (4); equity (4); capital expenditures (4); free cash flow (4); gross profit (4); operating expenses (4); working capital adjustments (3); longterm assets (3); net change in cash (3); earnings before interest and taxes (3); earnings before interest taxes depreciation and amortization (3); cash flow statement (2); ending cash balance (2); cash rollforward (2); capital structure (2); cash flow statement sections (2); operating working capital adjustments (2); depreciation (2); balance sheet snapshot (2); cash and cash equivalents (2); cash reconciliation (2); operating working capital (2); operating working capital changes (2)