import { ObjectInfoWrapper } from "../../../domain/entities/ObjectInfoWrapper";

describe('addObjectInfoKey', () => {

  test('given a new string key is added to an existing ObjectInfo Map the ObjectInfo map is updated with the new key', () => {
  
    const newTestKey:string = "Account";

    let objectInfoWrapper = new ObjectInfoWrapper();
    objectInfoWrapper.addKeyToObjectInfoMap(newTestKey);

    // SHOULD BE ONLY 1 KEY/VALUE PAIR
    for ( const objectKey in objectInfoWrapper.objectToObjectInfoMap ) {
      expect(objectKey).toBe(newTestKey);
    }

  });



});

