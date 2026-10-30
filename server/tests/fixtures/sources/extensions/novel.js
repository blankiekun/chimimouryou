// A novel source in Mangayomi's JS extension format, against the fake Syosetu (serve.py): the
// novel API's JSON for lists (apiUrl), the work page for details, chapter HTML for the text.
// For the app's extension runtime tests.
const mangayomiSources = [{
  "name": "Fixture novel",
  "lang": "ja",
  "baseUrl": "https://ncode.syosetu.com",
  "apiUrl": "https://api.syosetu.com",
  "iconUrl": "",
  "typeSource": "single",
  "itemType": 2,
  "version": "0.0.1",
  "pkgPath": "novel/src/ja/fixture.js"
}];

class DefaultExtension extends MProvider {
  async list(order, page) {
    const res = await new Client().get(`${this.source.apiUrl}/novelapi/api/?out=json&lim=20&order=${order}&st=${(page - 1) * 20 + 1}`);
    if (res.statusCode !== 200) throw new Error(`The API answered ${res.statusCode}`);
    const [count, ...works] = JSON.parse(res.body);
    return {
      list: works.map((w) => ({ name: w.title, imageUrl: "", link: `${this.source.baseUrl}/${w.ncode.toLowerCase()}/` })),
      hasNextPage: page * 20 < count.allcount
    };
  }
  getPopular(page) {
    return this.list("hyoka", page);
  }
  getLatestUpdates(page) {
    return this.list("new", page);
  }
  search(query, page, filters) {
    return this.list("hyoka", page);
  }
  async getDetail(url) {
    const doc = new Document((await new Client().get(url)).body);
    const chapters = doc.select(".p-eplist__sublist").map((row) => {
      const link = row.selectFirst("a.p-eplist__subtitle");
      return {
        name: link.text.trim(),
        url: this.source.baseUrl + link.attr("href"),
        dateUpload: parseDates([row.selectFirst(".p-eplist__update").text.trim().substringBefore("\n").replace(/\//g, "-")])[0]
      };
    });
    return {
      name: doc.selectFirst("h1.p-novel__title").text.trim(),
      imageUrl: "",
      description: doc.getElementById("novel_ex").text,
      author: doc.selectFirst(".p-novel__author a").text,
      status: 5,
      genre: [],
      chapters: chapters.reverse()
    };
  }
  async getHtmlContent(name, url) {
    const doc = new Document((await new Client().get(url)).body);
    return doc.select(".js-novel-text").map((part) => part.innerHtml).join("<hr>");
  }
  getFilterList() {
    return [];
  }
  getSourcePreferences() {
    return [];
  }
}
