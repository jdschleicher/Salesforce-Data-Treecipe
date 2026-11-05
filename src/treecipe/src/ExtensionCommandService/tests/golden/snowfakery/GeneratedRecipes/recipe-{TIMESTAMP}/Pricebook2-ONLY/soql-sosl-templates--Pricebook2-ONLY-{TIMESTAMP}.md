# SOQL & SOSL Query Templates

Generated: {TIMESTAMP}
Objects: Pricebook2

---

## Pricebook2

### Base Query

```sql
SELECT Id,
       IsStandard
FROM Pricebook2
```

### SOSL Template

```sosl
FIND {searchTerm} IN ALL FIELDS
RETURNING Pricebook2(Id)
```

---