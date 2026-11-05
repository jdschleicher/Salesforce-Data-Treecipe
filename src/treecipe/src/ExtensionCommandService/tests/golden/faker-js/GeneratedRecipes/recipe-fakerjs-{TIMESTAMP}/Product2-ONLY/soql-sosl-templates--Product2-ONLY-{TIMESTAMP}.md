# SOQL & SOSL Query Templates

Generated: {TIMESTAMP}
Objects: Product2

---

## Product2

### Base Query

```sql
SELECT Id,
       Cost__c,
       Current_Inventory__c,
       ExternalDataSourceId,
       Lifespan_Months__c,
       Maintenance_Cycle__c,
       Replacement_Part__c,
       SellerId,
       SourceProductId,
       StockKeepingUnit,
       Warehouse_SKU__c
FROM Product2
```

### SOSL Template

```sosl
FIND {searchTerm} IN ALL FIELDS
RETURNING Product2(Id, Warehouse_SKU__c)
```

---