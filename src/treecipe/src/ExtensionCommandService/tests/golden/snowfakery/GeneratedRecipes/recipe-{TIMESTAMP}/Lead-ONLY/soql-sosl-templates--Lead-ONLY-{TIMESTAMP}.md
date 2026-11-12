# SOQL & SOSL Query Templates

Generated: {TIMESTAMP}
Objects: Lead

---

## Lead

### Base Query

```sql
SELECT Id,
       Address,
       CampaignId,
       CleanStatus,
       CompanyDunsNumber,
       CurrentGenerators__c,
       CustomLeadCheck__c,
       DandbCompanyId,
       DoNotCall,
       Fax,
       GenderIdentity,
       HasOptedOutOfEmail,
       HasOptedOutOfFax,
       IndividualId,
       Jigsaw,
       LastTransferDate,
       NumberofLocations__c,
       OwnerId,
       Primary__c,
       ProductInterest__c,
       Pronouns,
       SICCode__c,
       Website,
       Salutation
FROM Lead
```

### SOSL Template

```sosl
FIND {searchTerm} IN ALL FIELDS
RETURNING Lead(Id, CurrentGenerators__c, SICCode__c, Salutation)
```

---