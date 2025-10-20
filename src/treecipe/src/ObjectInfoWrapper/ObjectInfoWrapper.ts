import { RecipeFileOutput, RelationshipTree } from "../RelationshipService/RelationshipService";
import { ObjectInfo } from "./ObjectInfo";

export class ObjectInfoWrapper {
  
  ObjectToObjectInfoMap:Record<string, ObjectInfo> = {};

  RecipeFiles?: RecipeFileOutput[];

  RelationshipTrees?: RelationshipTree[];

  public addKeyToObjectInfoMap(objectApiName: string) {

    // WITH THE ITERATION OF OBJECTS AND THE NEED TO ADD REFERENCES BASED ON LOOKUPS
    // AN OBJECT KEY COULD BE ADDED DUE TO A LOOKUP RELATIONSHIP BEFORE AN OBJECT IS ITERATED OVER
    if ( !(objectApiName in this.ObjectToObjectInfoMap) ) {
      this.ObjectToObjectInfoMap[objectApiName] = new ObjectInfo(objectApiName);
    }

  }

  
}



