/// <reference types="@sveltejs/kit" />

declare global {
  namespace App {
    interface PageState {
      /** Library: id of the book whose page is shown */
      bookDetails?: number;
      /** Library: title of the book whose page is shown, from another page (Community's Now reading) */
      bookTitle?: string;
      /** Library: id of the book whose word list is shown over its page */
      bookWords?: number;
      /** Home and /friends: username of the social profile shown */
      profile?: string;
    }
  }
  interface HTMLElement {
    scrollIntoViewIfNeeded(arg?: boolean): void;
  }
  interface Navigator {
    msMaxTouchPoints: number;
    standalone: boolean | undefined;
  }
}

export {};
