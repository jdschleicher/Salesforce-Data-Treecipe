import { ObjectInfo } from "./ObjectInfo";

export class ObjectInfoWrapper {
  

  ObjectToObjectInfoMap:Record<string, ObjectInfo> = {};
  CombinedRecipes:string = "";


  public addKeyToObjectInfoMap(objectApiName: string) {

    // WITH THE ITERATION OF OBJECTS AND THE NEED TO ADD REFERENCES BASED ON LOOKUPS
    // AN OBJECT KEY COULD BE ADDED DUE TO A LOOKUP RELATIONSHIP BEFORE AN OBJECT IS ITERATED OVER
    if ( !(objectApiName in this.ObjectToObjectInfoMap) ) {
      this.ObjectToObjectInfoMap[objectApiName] = new ObjectInfo(objectApiName);
    }

  }
  // public addRelationshipByFieldInfo(fieldInfo: FieldInfo) {

  //   let relationshipService = new RelationshipService();
  //   let objectRelationshipDetail = this.objects.get(fieldInfo.objectName).relationshipDetail;
  //   if ( !objectRelationshipDetail ) {
  //     // ADD OBJECT TO RELATIONSHIP TRACKER IF NOT YET BEING TRACKED
  //     objectRelationshipDetail = relationshipService.buildNewRelationshipDetail();
  //     this.objects.get(fieldInfo.objectName).relationshipDetail = objectRelationshipDetail;
  //   }

  //   if ( fieldInfo.type === 'Lookup' || fieldInfo.type === 'MasterDetail') {
  //     // get child object reference lookup count for maxtotal
  //     // 
    
  //     if (this.objects.has(fieldInfo.referenceTo)) {

  //       this.objects.get(fieldInfo.referenceTo).relationshipDetail = relationshipService.updateRelationshipDetail();

  //     } else {
  //       // add new relationshiptracker
  //       // add new child breakdown
  //       this.objects[fieldInfo.referenceTo] = this.addObject(fieldInfo.referenceTo);
  //       this.objects.get(fieldInfo.referenceTo).relationshipDetail = relationshipService.buildNewRelationshipDetail();

  //       let relationshipDetail = relationshipService.updateRelationshipDetail();
  //       // or new relationshiipDetailByChildObjectInfo
  //     }
  

  //   }

  // }

  
}



