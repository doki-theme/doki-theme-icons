import xmlParser from "xml2js";
import * as fs from "fs";
import deepClone from "lodash/cloneDeep";
import builder from "xmlbuilder";

const parser = new xmlParser.Parser({
  explicitChildren: true,
  mergeAttrs: false,
  preserveChildrenOrder: true,
});

const toXml = (xml1: string): Promise<any> => parser.parseStringPromise(xml1);

function constructSVG(root: any, children: any[]) {
  if (!children) {
    return;
  }

  for (const child of children) {
    const childNode = root.ele(child["#name"], child.$ || {});
    constructSVG(childNode, child.$$);
  }
}

function buildXml(workingCopy: any): string {
  const svg = workingCopy.svg;
  const root = builder.create(svg["#name"]);

  Object.entries(svg.$).forEach(([attributeKey, attributeValue]) =>
    root.att(attributeKey, attributeValue)
  );

  constructSVG(root, svg.$$);

  return root.end({ pretty: true });
}

Promise.resolve()
  .then(async () => {
    const svgPath =
      "/Users/alexsimons/workspace/doki-theme-icons/icons/exported/breakpoint.svg";
    const generatedFilePath =
      "/Users/alexsimons/workspace/doki-theme-icons/icons/generated/breakpoint.svg";
    const svgAsXML = await toXml(
      fs.readFileSync(svgPath, { encoding: "utf-8" })
    );
    const workingCopy = deepClone(svgAsXML);

    const xmlString = buildXml(workingCopy);

    fs.writeFileSync(generatedFilePath, xmlString, {
      encoding: "utf-8",
    });
  })
  .then(() => {
    console.log("Icon Generation Complete!");
  });
