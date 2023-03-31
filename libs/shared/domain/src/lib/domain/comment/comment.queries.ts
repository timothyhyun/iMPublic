import { createQuery } from '@orcha/common';
import { Comment } from './comment.model';

export const CommentQuery = createQuery<Comment>()({
  id: true,
  text: true,
  dateCreated: true,
  hidden: true,
  flagCount: true,
  // activityPost: {
  //   id: true
  // },
  user: {
    id: true,
    /** Probably want to fetch user handle */
  },
  flags: {
    id: true,
    user: {
      id: true
    },
  }
})