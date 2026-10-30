// A manga source in Mangayomi's JS extension format, against the fake Kakuyomu (serve.py): works and
// chapters from the pages' __NEXT_DATA__, one page image per paragraph from the CDN host, which only
// getPageList names (so the app learns it as an image host). For the app's extension runtime tests.
const mangayomiSources = [{
  "name": "Fixture manga",
  "lang": "ja",
  "baseUrl": "https://kakuyomu.jp",
  "apiUrl": "",
  "iconUrl": "",
  "typeSource": "single",
  "itemType": 0,
  "version": "0.0.1",
  "pkgPath": "manga/src/ja/fixture.js"
}];

class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client();
  }
  getHeaders(url) {
    return { Referer: this.source.baseUrl, "User-Agent": "Mozilla/5.0 fixture" };
  }
  apollo(body) {
    return JSON.parse(new Document(body).selectFirst("script#__NEXT_DATA__").text).props.pageProps.__APOLLO_STATE__;
  }
  async getPopular(page) {
    const res = await this.client.get(`${this.source.baseUrl}/search?order=popular&page=${page}`, this.getHeaders());
    const state = this.apollo(res.body);
    const list = Object.values(state).filter((v) => v.__typename === "Work").map((w) => ({
      name: w.title,
      imageUrl: w.adminCoverImageUrl || "",
      link: `${this.source.baseUrl}/works/${w.id}`
    }));
    return { list, hasNextPage: false };
  }
  async getLatestUpdates(page) {
    return this.getPopular(page);
  }
  async search(query, page, filters) {
    return this.getPopular(page);
  }
  async getDetail(url) {
    const res = await this.client.get(url, this.getHeaders());
    const state = this.apollo(res.body);
    const work = Object.values(state).find((v) => v.__typename === "Work");
    const id = url.substringAfter("/works/");
    const chapters = Object.values(state).filter((v) => v.__typename === "Episode").map((e) => ({
      name: e.title,
      url: `${this.source.baseUrl}/works/${id}/episodes/${e.id}`,
      dateUpload: parseDates([e.publishedAt])[0]
    })).reverse();
    return {
      name: work.title,
      imageUrl: work.adminCoverImageUrl,
      description: work.introduction,
      author: state[work.author.__ref].activityName,
      status: work.serialStatus === "RUNNING" ? 0 : 1,
      genre: [],
      chapters
    };
  }
  async getPageList(url) {
    const res = await this.client.get(url, this.getHeaders());
    const paragraphs = new Document(res.body).selectFirst(".widget-episodeBody").select("p");
    return paragraphs.map((p, i) => ({ url: `https://cdn.kdkw.jp/page/${i}.png`, headers: this.getHeaders() }));
  }
  getFilterList() {
    return [];
  }
  getSourcePreferences() {
    return [];
  }
}
