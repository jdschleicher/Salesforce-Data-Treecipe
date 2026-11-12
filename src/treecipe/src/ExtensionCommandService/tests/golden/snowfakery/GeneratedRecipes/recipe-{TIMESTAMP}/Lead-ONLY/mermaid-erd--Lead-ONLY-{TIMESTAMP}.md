# Entity Relationship Diagram

This diagram illustrates the object model for the Salesforce entities in this Treecipe tree.
Each entity block lists its typed fields (string, number, date, datetime, boolean).
Lookup relationships are shown with `|o--o{` cardinality (optional parent).
MasterDetail relationships are shown with `||--o{` cardinality (required parent).
Cross-tree relationships are excluded — only objects present in this recipe are shown.

Generated: {TIMESTAMP}
Objects: Lead

---

```mermaid
erDiagram
    Lead {
        id Id
        string Address
        string CleanStatus
        string CompanyDunsNumber
        string CurrentGenerators__c
        boolean CustomLeadCheck__c
        string DoNotCall
        string Fax
        string GenderIdentity
        string HasOptedOutOfEmail
        string HasOptedOutOfFax
        string Jigsaw
        string LastTransferDate
        number NumberofLocations__c
        string Primary__c
        string ProductInterest__c
        string Pronouns
        string SICCode__c
        string Website
        string Salutation
    }

```