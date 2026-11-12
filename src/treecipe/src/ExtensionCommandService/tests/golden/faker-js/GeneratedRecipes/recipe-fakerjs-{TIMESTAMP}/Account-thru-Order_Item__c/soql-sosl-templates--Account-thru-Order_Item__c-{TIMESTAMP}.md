# SOQL & SOSL Query Templates

Generated: {TIMESTAMP}
Objects: Account, Contact, Example_Everything__c, MasterDetailMadness__c, MegaMapMadness__c, Opportunity, Order_Item__c, Order__c, Product_Family__c, Product__c, User

---

## Account

### Base Query

```sql
SELECT Id,
       AccountSource,
       Active__c,
       CustomerPriority__c,
       Jigsaw,
       Number_of_Contacts__c,
       OwnerId,
       ParentId,
       SLAExpirationDate__c,
       SLASerialNumber__c,
       SLA__c,
       ShippingAddress,
       SicDesc,
       Site,
       TickerSymbol,
       UpsellOpportunity__c
FROM Account
```

### Child-to-Parent Queries

```sql
-- Hierarchy to Account via ParentId
SELECT Id,
       ParentId,
       Parent.AccountSource,
       Parent.Active__c,
       Parent.CustomerPriority__c,
       Parent.Jigsaw,
       Parent.Number_of_Contacts__c
FROM Account
```

### Parent-to-Child Queries

```sql
-- Children: Account (via ParentId)
-- Note: Verify 'Accounts' is the correct Child Relationship Name
SELECT Id,
    (SELECT Id, AccountSource, Active__c, CustomerPriority__c, Jigsaw, Number_of_Contacts__c
     FROM Accounts)
FROM Account
```

```sql
-- Children: Contact (via AccountId)
-- Note: Verify 'Contacts' is the correct Child Relationship Name
SELECT Id,
    (SELECT Id, OtherAddress
     FROM Contacts)
FROM Account
```

```sql
-- Children: Example_Everything__c (via AccountLookup__c)
-- Note: Verify 'Example_Everythings__r' is the correct Child Relationship Name
SELECT Id,
    (SELECT Id, Checkbox__c, Currency__c, DateOne__c, DateTimeOne__c, DateTimeTwo__c
     FROM Example_Everythings__r)
FROM Account
```

```sql
-- Children: Opportunity (via AccountId)
-- Note: Verify 'Opportunitys' is the correct Child Relationship Name
SELECT Id,
    (SELECT Id, CurrentGenerators__c, DeliveryInstallationStatus__c, IqScore, IsPrivate, MainCompetitors__c
     FROM Opportunitys)
FROM Account
```

```sql
-- Children: Order__c (via Account__c)
-- Note: Verify 'Orders__r' is the correct Child Relationship Name
SELECT Id,
    (SELECT Id, Status__c, Type__c
     FROM Orders__r)
FROM Account
```

### SOSL Template

```sosl
FIND {searchTerm} IN ALL FIELDS
RETURNING Account(Id, SLASerialNumber__c)
```

---

## Contact

### Base Query

```sql
SELECT Id,
       AccountId,
       OtherAddress,
       ReportsToId,
       UserOfAContact_1__c,
       Userlookup_2__c
FROM Contact
```

### Child-to-Parent Queries

```sql
-- Lookup to Account via AccountId
SELECT Id,
       AccountId,
       Account.AccountSource,
       Account.Active__c,
       Account.CustomerPriority__c,
       Account.Jigsaw,
       Account.Number_of_Contacts__c
FROM Contact
```

```sql
-- Lookup to Contact via ReportsToId
SELECT Id,
       ReportsToId,
       ReportsTo.OtherAddress
FROM Contact
```

```sql
-- Lookup to User via UserOfAContact_1__c
SELECT Id,
       UserOfAContact_1__c
FROM Contact
```

```sql
-- Lookup to User via Userlookup_2__c
SELECT Id,
       Userlookup_2__c
FROM Contact
```

### Parent-to-Child Queries

```sql
-- Children: Contact (via ReportsToId)
-- Note: Verify 'Contacts' is the correct Child Relationship Name
SELECT Id,
    (SELECT Id, OtherAddress
     FROM Contacts)
FROM Contact
```

```sql
-- Children: MasterDetailMadness__c (via LU_Contact__c)
-- Note: Verify 'MasterDetailMadnesss__r' is the correct Child Relationship Name
SELECT Id,
    (SELECT Id
     FROM MasterDetailMadnesss__r)
FROM Contact
```

### SOSL Template

```sosl
FIND {searchTerm} IN ALL FIELDS
RETURNING Contact(Id)
```

---

## Example_Everything__c

### Base Query

```sql
SELECT Id,
       AccountLookup__c,
       Checkbox__c,
       Currency__c,
       DateOne__c,
       DateTimeOne__c,
       DateTimeTwo__c,
       DateTime__c,
       DateTwo__c,
       Date__c,
       Picklist__c,
       DependentPicklist__c,
       Email__c,
       Example_Everything_Lookup__c,
       Formula__c,
       GlobalSuperDependent__c,
       GlobalValuePicklist__c,
       MultiPicklist__c,
       Number__c,
       Percent__c,
       Phone__c,
       PlanetGlobalValuePicklist__c,
       RichTextAreaHtml__c,
       SuperDependent__c,
       TextAreaRich__c,
       Text_Area_Long__c,
       Text__c,
       Time__c,
       Url__c,
       Geolocation__Latitude__s,
       Geolocation__Longitude__s
FROM Example_Everything__c
```

### Child-to-Parent Queries

```sql
-- Lookup to Account via AccountLookup__c
SELECT Id,
       AccountLookup__c,
       AccountLookup__r.AccountSource,
       AccountLookup__r.Active__c,
       AccountLookup__r.CustomerPriority__c,
       AccountLookup__r.Jigsaw,
       AccountLookup__r.Number_of_Contacts__c
FROM Example_Everything__c
```

```sql
-- Lookup to Example_Everything__c via Example_Everything_Lookup__c
SELECT Id,
       Example_Everything_Lookup__c,
       Example_Everything_Lookup__r.Checkbox__c,
       Example_Everything_Lookup__r.Currency__c,
       Example_Everything_Lookup__r.DateOne__c,
       Example_Everything_Lookup__r.DateTimeOne__c,
       Example_Everything_Lookup__r.DateTimeTwo__c
FROM Example_Everything__c
```

### Parent-to-Child Queries

```sql
-- Children: Example_Everything__c (via Example_Everything_Lookup__c)
-- Note: Verify 'Example_Everythings__r' is the correct Child Relationship Name
SELECT Id,
    (SELECT Id, Checkbox__c, Currency__c, DateOne__c, DateTimeOne__c, DateTimeTwo__c
     FROM Example_Everythings__r)
FROM Example_Everything__c
```

### Record Type Filtered Queries

```sql
-- Record Type: OneRecType
SELECT Id,
       Checkbox__c,
       Currency__c,
       DateOne__c,
       DateTimeOne__c,
       DateTimeTwo__c,
       DateTime__c,
       DateTwo__c,
       Date__c,
       Picklist__c,
       DependentPicklist__c,
       Email__c,
       Formula__c,
       GlobalSuperDependent__c,
       GlobalValuePicklist__c,
       MultiPicklist__c,
       Number__c,
       Percent__c,
       Phone__c,
       PlanetGlobalValuePicklist__c,
       RichTextAreaHtml__c,
       SuperDependent__c,
       TextAreaRich__c,
       Text_Area_Long__c,
       Text__c,
       Time__c,
       Url__c,
       Geolocation__Latitude__s,
       Geolocation__Longitude__s
FROM Example_Everything__c
WHERE RecordType.DeveloperName = 'OneRecType'
```

```sql
-- Record Type: TwoRecType
SELECT Id,
       Checkbox__c,
       Currency__c,
       DateOne__c,
       DateTimeOne__c,
       DateTimeTwo__c,
       DateTime__c,
       DateTwo__c,
       Date__c,
       Picklist__c,
       DependentPicklist__c,
       Email__c,
       Formula__c,
       GlobalSuperDependent__c,
       GlobalValuePicklist__c,
       MultiPicklist__c,
       Number__c,
       Percent__c,
       Phone__c,
       PlanetGlobalValuePicklist__c,
       RichTextAreaHtml__c,
       SuperDependent__c,
       TextAreaRich__c,
       Text_Area_Long__c,
       Text__c,
       Time__c,
       Url__c,
       Geolocation__Latitude__s,
       Geolocation__Longitude__s
FROM Example_Everything__c
WHERE RecordType.DeveloperName = 'TwoRecType'
```

### SOSL Template

```sosl
FIND {searchTerm} IN ALL FIELDS
RETURNING Example_Everything__c(Id, Email__c, Phone__c, RichTextAreaHtml__c, TextAreaRich__c, Text_Area_Long__c, Text__c, Url__c, Geolocation__Latitude__s, Geolocation__Longitude__s)
```

---

## MasterDetailMadness__c

### Base Query

```sql
SELECT Id,
       LU_Contact__c,
       MD_MegaMapMadness__c
FROM MasterDetailMadness__c
```

### Child-to-Parent Queries

```sql
-- Lookup to Contact via LU_Contact__c
SELECT Id,
       LU_Contact__c,
       LU_Contact__r.OtherAddress
FROM MasterDetailMadness__c
```

```sql
-- MasterDetail to MegaMapMadness__c via MD_MegaMapMadness__c
SELECT Id,
       MD_MegaMapMadness__c,
       MD_MegaMapMadness__r.CheckMadness__c
FROM MasterDetailMadness__c
```

### SOSL Template

```sosl
FIND {searchTerm} IN ALL FIELDS
RETURNING MasterDetailMadness__c(Id)
```

---

## MegaMapMadness__c

### Base Query

```sql
SELECT Id,
       CheckMadness__c,
       LUOne_User__c,
       LUTwo_User__c
FROM MegaMapMadness__c
```

### Child-to-Parent Queries

```sql
-- Lookup to User via LUOne_User__c
SELECT Id,
       LUOne_User__c
FROM MegaMapMadness__c
```

```sql
-- Lookup to User via LUTwo_User__c
SELECT Id,
       LUTwo_User__c
FROM MegaMapMadness__c
```

### Parent-to-Child Queries

```sql
-- Children: MasterDetailMadness__c (via MD_MegaMapMadness__c)
-- Note: Verify 'MasterDetailMadnesss__r' is the correct Child Relationship Name
SELECT Id,
    (SELECT Id
     FROM MasterDetailMadnesss__r)
FROM MegaMapMadness__c
```

### SOSL Template

```sosl
FIND {searchTerm} IN ALL FIELDS
RETURNING MegaMapMadness__c(Id)
```

---

## Opportunity

### Base Query

```sql
SELECT Id,
       AccountId,
       CampaignId,
       ContractId,
       CurrentGenerators__c,
       DeliveryInstallationStatus__c,
       IqScore,
       IsPrivate,
       MainCompetitors__c,
       OrderNumber__c,
       OwnerId,
       Pricebook2Id,
       TotalOpportunityQuantity,
       TrackingNumber__c
FROM Opportunity
```

### Child-to-Parent Queries

```sql
-- Lookup to Account via AccountId
SELECT Id,
       AccountId,
       Account.AccountSource,
       Account.Active__c,
       Account.CustomerPriority__c,
       Account.Jigsaw,
       Account.Number_of_Contacts__c
FROM Opportunity
```

### SOSL Template

```sosl
FIND {searchTerm} IN ALL FIELDS
RETURNING Opportunity(Id, CurrentGenerators__c, MainCompetitors__c, OrderNumber__c, TrackingNumber__c)
```

---

## Order_Item__c

### Base Query

```sql
SELECT Id,
       Order__c,
       Price__c,
       Product__c,
       Qty_L__c,
       Qty_M__c,
       Qty_S__c
FROM Order_Item__c
```

### Child-to-Parent Queries

```sql
-- MasterDetail to Order__c via Order__c
SELECT Id,
       Order__c,
       Order__r.Status__c,
       Order__r.Type__c
FROM Order_Item__c
```

```sql
-- Lookup to Product__c via Product__c
SELECT Id,
       Product__c,
       Product__r.Battery__c,
       Product__r.Category__c,
       Product__r.Charger__c,
       Product__r.Description__c,
       Product__r.Fork__c
FROM Order_Item__c
```

### SOSL Template

```sosl
FIND {searchTerm} IN ALL FIELDS
RETURNING Order_Item__c(Id)
```

---

## Order__c

### Base Query

```sql
SELECT Id,
       Account__c,
       Status__c,
       Type__c
FROM Order__c
```

### Child-to-Parent Queries

```sql
-- Lookup to Account via Account__c
SELECT Id,
       Account__c,
       Account__r.AccountSource,
       Account__r.Active__c,
       Account__r.CustomerPriority__c,
       Account__r.Jigsaw,
       Account__r.Number_of_Contacts__c
FROM Order__c
```

### Parent-to-Child Queries

```sql
-- Children: Order_Item__c (via Order__c)
-- Note: Verify 'Order_Items__r' is the correct Child Relationship Name
SELECT Id,
    (SELECT Id, Price__c, Qty_L__c, Qty_M__c, Qty_S__c
     FROM Order_Items__r)
FROM Order__c
```

### SOSL Template

```sosl
FIND {searchTerm} IN ALL FIELDS
RETURNING Order__c(Id)
```

---

## Product_Family__c

### Base Query

```sql
SELECT Id,
       Category__c,
       Description__c
FROM Product_Family__c
```

### Parent-to-Child Queries

```sql
-- Children: Product__c (via Product_Family__c)
-- Note: Verify 'Products__r' is the correct Child Relationship Name
SELECT Id,
    (SELECT Id, Battery__c, Category__c, Charger__c, Description__c, Fork__c
     FROM Products__r)
FROM Product_Family__c
```

### SOSL Template

```sosl
FIND {searchTerm} IN ALL FIELDS
RETURNING Product_Family__c(Id, Description__c)
```

---

## Product__c

### Base Query

```sql
SELECT Id,
       Battery__c,
       Category__c,
       Charger__c,
       Description__c,
       Fork__c,
       Frame_Color__c,
       Front_Brakes__c,
       Handlebar_Color__c,
       Level__c,
       MSRP__c,
       Material__c,
       Motor__c,
       Picture_URL__c,
       Product_Family__c,
       Rear_Brakes__c,
       Seat_Color__c,
       Waterbottle_Color__c
FROM Product__c
```

### Child-to-Parent Queries

```sql
-- Lookup to Product_Family__c via Product_Family__c
SELECT Id,
       Product_Family__c,
       Product_Family__r.Category__c,
       Product_Family__r.Description__c
FROM Product__c
```

### Parent-to-Child Queries

```sql
-- Children: Order_Item__c (via Product__c)
-- Note: Verify 'Order_Items__r' is the correct Child Relationship Name
SELECT Id,
    (SELECT Id, Price__c, Qty_L__c, Qty_M__c, Qty_S__c
     FROM Order_Items__r)
FROM Product__c
```

### SOSL Template

```sosl
FIND {searchTerm} IN ALL FIELDS
RETURNING Product__c(Id, Battery__c, Charger__c, Description__c, Fork__c, Front_Brakes__c, Motor__c, Picture_URL__c, Rear_Brakes__c)
```

---

## User

### Base Query

```sql
SELECT Id
FROM User
```

### Parent-to-Child Queries

```sql
-- Children: Contact (via UserOfAContact_1__c, Userlookup_2__c)
-- Note: Verify 'Contacts' is the correct Child Relationship Name
SELECT Id,
    (SELECT Id, OtherAddress
     FROM Contacts)
FROM User
```

```sql
-- Children: MegaMapMadness__c (via LUOne_User__c, LUTwo_User__c)
-- Note: Verify 'MegaMapMadnesss__r' is the correct Child Relationship Name
SELECT Id,
    (SELECT Id, CheckMadness__c
     FROM MegaMapMadnesss__r)
FROM User
```

### SOSL Template

```sosl
FIND {searchTerm} IN ALL FIELDS
RETURNING User(Id)
```

---