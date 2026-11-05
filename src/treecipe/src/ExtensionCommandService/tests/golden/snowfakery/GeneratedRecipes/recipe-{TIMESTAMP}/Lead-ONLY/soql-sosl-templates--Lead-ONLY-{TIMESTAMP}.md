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
       Name,
       NumberofLocations__c,
       OwnerId,
       Primary__c,
       ProductInterest__c,
       Pronouns,
       SICCode__c,
       Website
FROM Lead
```

### SOSL Template

```sosl
FIND {searchTerm} IN ALL FIELDS
RETURNING Lead(Id, CurrentGenerators__c, SICCode__c)
```

---