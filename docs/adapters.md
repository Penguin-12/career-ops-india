# ATS Protocol Adapters Reference — Career-Ops India

**Career-Ops India** operates 11 dedicated, zero-browser protocol adapters in [`scripts/adapters/`](file:///Users/joshwadhwa/Projects/repos/career-ops-india/scripts/adapters/). Each adapter interfaces directly with employer ATS backend REST/JSON/SSR endpoints.

---

## 1. Adapter Matrix & Implementation Details

### 1. Workday (`scripts/adapters/workday.mjs`)
- **Protocol**: REST JSON API (`POST /wday/cxs/{tenant}/{site}/jobs`)
- **Pagination**: Offset-based (`offset`, `limit: 20`, up to 5 pages max).
- **Target Companies**: Visa, Mastercard, Adobe, Walmart, Target, Nvidia, AMD, Intuit, Salesforce, Autodesk.
- **Normalization**: Extracts requisition ID (e.g. `REF081481W`), title, location, posted date (`postedOn`), and constructs direct Workday candidate URL.
- **Edge Cases**: Handles tenant subdomains (`wd1`, `wd3`, `wd5`, `wd12`) and multi-location arrays.

### 2. SmartRecruiters (`scripts/adapters/smartrecruiters.mjs`)
- **Protocol**: Public REST JSON API (`GET /v1/companies/{company}/postings`)
- **Pagination**: Offset-based (`offset`, `limit: 100`).
- **Target Companies**: ServiceNow, Bosch, Sandisk, Western Digital.
- **Normalization**: Normalizes custom location hierarchies (`city`, `region`, `country: "in"`), experience levels, and department objects.

### 3. Greenhouse (`scripts/adapters/greenhouse.mjs`)
- **Protocol**: Public Board JSON API (`GET /v1/boards/{slug}/jobs?content=true`)
- **Pagination**: Single unpaginated payload returning all active requisitions.
- **Target Companies**: Okta, GitLab, Twilio, Postman, Stripe, Atlassian, Rubrik, Databricks.
- **Normalization**: Strips HTML tags from job description body, parses office locations and custom department metadata.

### 4. Lever (`scripts/adapters/lever.mjs`)
- **Protocol**: Postings JSON API (`GET /v1/apps/{slug}`)
- **Pagination**: Limit/skip query parameters.
- **Target Companies**: Fi Money, Jupiter, CRED, Slice, Razorpay.
- **Normalization**: Extracts categories (`team`, `department`, `location`, `commitment`) and maps plain text lists to experience text.

### 5. Ashby (`scripts/adapters/ashby.mjs`)
- **Protocol**: Job Board GraphQL / Non-native API (`POST /api/non-native-cached/job-board/{slug}`)
- **Pagination**: Full board payload.
- **Target Companies**: High-growth YC & AI engineering startups.
- **Normalization**: Normalizes secondary locations, compensation tier objects, and employment types.

### 6. Microsoft Careers (`scripts/adapters/microsoft.mjs`)
- **Protocol**: Career Search REST API (`GET https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&location=India&results_per_page=100`)
- **Pagination**: Offset and limit (`start`, `results_per_page`).
- **Target Companies**: Microsoft India.
- **Normalization**: Normalizes multi-location strings, fallback timestamp fields, and generates canonical direct application URLs.

### 7. Oracle Cloud HCM (`scripts/adapters/oraclecloud.mjs`)
- **Protocol**: Candidate Experience REST API (`GET /hcmRestApi/resources/latest/recruitingCEJobRequisitions?finder=findReqs;siteNumber={site},locationCountryList=IN`)
- **Pagination**: Limit and offset (`limit: 25`, `offset`).
- **Target Companies**: JPMorgan Chase, Goldman Sachs.
- **Normalization**: Extracts `ExternalQualificationsStr`, `ShortDescriptionStr`, and builds direct candidate requisition preview links.

### 8. Google Careers (`scripts/adapters/google.mjs`)
- **Protocol**: Server-Side Rendered (SSR) HTML state extraction.
- **Mechanism**: Extracts embedded `AF_initDataCallback` (`ds:1`) JSON state block.
- **Target Companies**: Google India (Bengaluru, Hyderabad, Gurugram, Pune).
- **Normalization**: Converts nested position arrays into canonical fields; zero browser automation required.

### 9. D.E. Shaw (`scripts/adapters/deshaw.mjs`)
- **Protocol**: Next.js Server-Side Rendered state extraction.
- **Mechanism**: Extracts embedded `<script id="__NEXT_DATA__">` `props.pageProps.regularJobs`.
- **Target Companies**: D.E. Shaw India (Hyderabad, Bengaluru, Gurugram).
- **Normalization**: Extracts job slugs, department headers, and office location arrays.

### 10. Amazon (`scripts/adapters/amazon.mjs`)
- **Protocol**: Amazon Jobs Search REST API (`GET /api/v1/job_search?country=IND&offset=0&result_limit=100`)
- **Pagination**: Offset and limit.
- **Target Companies**: Amazon India, AWS.
- **Normalization**: Normalizes basic qualifications, preferred qualifications, and direct requisition links.

### 11. Radancy / TalentBrew (`scripts/adapters/radancy.mjs`)
- **Protocol**: TalentBrew SSR HTML card parser with search result pagination.
- **Pagination**: Page-based (`/search-jobs/results?page={n}`).
- **Target Companies**: Barclays, Capital One, Intuit, Arm, Palo Alto Networks, Charles Schwab, Optum.
- **Normalization**: Decodes HTML entities, parses numeric requisition IDs, and attaches canonical direct application URLs.

### 12. SAP SuccessFactors (`scripts/adapters/successfactors.mjs`)
- **Protocol**: Career Site Builder (CSB) table pagination.
- **Pagination**: Row-based (`startrow={n}`).
- **Target Companies**: SAP Labs India.
- **Normalization**: Extracts job table metadata, parses ISO UTC timestamps, and builds canonical `jobs.sap.com` links.

### 13. IBM Careers (`scripts/adapters/ibm.mjs`)
- **Protocol**: IBM Public Search REST API v1 (`scope=careers2`).
- **Pagination**: Offset/limit (`fr={offset}&nr={pageSize}`).
- **Target Companies**: IBM India.
- **Normalization**: Maps JSON document attributes, city metadata, and extracts requisition numbers from canonical detail URLs.

### 14. MyNextHire (`scripts/adapters/mynexthire.mjs`)
- **Protocol**: Public Career Portal API.
- **Target Companies**: Indian product tech firms and venture-backed scale-ups.

---

## 2. Universal Adapter Contract

All active adapters adhere to the following interface:

```typescript
interface ATSAdapter {
  id: string;                                // e.g. "workday", "greenhouse"
  type: "employer_ats" | "employer_careers";
  
  // Queries remote platform and returns raw postings
  fetchJobs(companyConfig: CompanyPortalConfig): Promise<{
    jobs: any[];
    err?: string;
  }>;

  // Transforms raw ATS entity into CanonicalJob
  normalize(rawJob: any, companyConfig: CompanyPortalConfig): CanonicalJob;
}
```
