import {
  dictionaryReducer,
  resolvePaths, StringDictionary,
  walkDir,
} from "doki-build-source";
import path from "path";
import xmlParser from "xml2js";
import * as fs from "fs";
import deepClone from 'lodash/cloneDeep';

const xmlBuilder = new xmlParser.Builder({
  renderOpts: {
    pretty: false
  }
});

const toXml = (xml1: string): Promise<any> =>
  xmlParser.parseStringPromise(xml1)

const {
  appTemplatesDirectoryPath
} = resolvePaths(__dirname);


type IconMapping = {
  iconName: string;
  sizes: number[];
}

const iconsDir = path.resolve(__dirname, '..', '..', 'icons',);
const exportedIconsDir = path.join(iconsDir, 'exported');
const generatedIconsDir = path.join(iconsDir, 'generated');

console.log("Preparing to generate icons.");
walkDir(exportedIconsDir)
  .then(async icons => {
    const svgNameToPatho = icons.reduce((accum, generatedIconPath) => {
      const svgName = generatedIconPath.substring(exportedIconsDir.length + 1);
      accum[svgName] = generatedIconPath;
      return accum;
    }, {} as StringDictionary<string>)

    const jetbrainsMappings: IconMapping[] = JSON.parse(
      fs.readFileSync(path.join(appTemplatesDirectoryPath, 'jetbrains.mappings.json'), {
        encoding: 'utf-8',
      })
    );

    for (const iconMapping of jetbrainsMappings) {
      const iconName = iconMapping.iconName;
      const exportedPath = svgNameToPatho[iconName];
      if (!exportedPath) {
        throw new Error(`Hey silly, you forgot to export ${iconName}`)
      }

      const svgAsXML = await toXml(fs.readFileSync(exportedPath, {encoding: 'utf-8'}));
      iconMapping.sizes.forEach((iconSize) => {
        const workingCopy = deepClone(svgAsXML);
        const fileNameWithoutExtension = iconName.substring(0, iconName.length - 4);
        const newFileName = `${fileNameWithoutExtension}_${iconSize}x${iconSize}.svg`;
        const generatedFilePath = path.join(generatedIconsDir, newFileName);
        workingCopy.svg.$.width = `${iconSize}px`;
        workingCopy.svg.$.height = `${iconSize}px`;

        fs.writeFileSync(
          generatedFilePath,
          xmlBuilder.buildObject(workingCopy),
          {encoding: 'utf-8'}
        )
      })

    }
  })
  .then(() => {
    console.log("Icon Generation Complete!");
  });
