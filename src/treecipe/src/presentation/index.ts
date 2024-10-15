
import { ObjectInfoWrapper } from '../domain/entities/ObjectInfoWrapper';
import { processDirectory } from '../infrastructure/fileSystem/DirectoryProcessor';

import * as fs from 'fs';

export function main() {

  const objectsDirectory = './main/default/objects';
  let objectsInfoWrapper = new ObjectInfoWrapper();
  objectsInfoWrapper = processDirectory(objectsDirectory, objectsInfoWrapper);

// Now you can stringify it
//   const jsonString = JSON.stringify(objectsInfoWrapper.recipes, null, 2);
//   console.log(jsonString);

  // const jsonData = JSON.stringify(objectFieldTracker, null, 2);

  fs.writeFile('output.yaml', objectsInfoWrapper.combinedRecipes, (err) => {
      if (err) {
          console.error('Error writing file', err);
      } else {
          console.log('Data written to file successfully');
      }
  });

}


main();