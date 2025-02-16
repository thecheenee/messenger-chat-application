/* eslint-disable no-unused-vars */
/* eslint-disable no-console */
const chatModel = require('../models/chatModel');
const data = require('../data/messageStore');

module.exports.addChat = async (req, res) => {
  /** create a chat with agent, customer, status as approved, resolution as empty, start time as current time, end time as null */
  try {
    const { agentId, agentUserName, custId, custUserName, status, verified } =
      req.body;
    const chatPresent = await chatModel.findOne({
      customerId: custId,
      customerName: custUserName,
    });

    if (chatPresent && chatPresent.length > 0) {
      throw data.chat.chatPresent;
    } else {
      if (status === data.status.active && verified) {
        const chatCreate = await chatModel.create({
          agentId: agentId,
          agentName: agentUserName,
          customerId: custId,
          customerName: custUserName,
          status: data.chat.started,
          rating: '',
          resolution: '',
          chatEndedBy: '',
          startTime: new Date(),
          endTime: '',
        });
        if (chatCreate) {
          res.status(200).json({
            success: true,
            message: data.chat.started,
            detail: chatCreate,
          });
        } else throw data.chat.startFailed;
      } else {
        throw data.authErrors.verifyFailed;
      }
    }
  } catch (err) {
    res.status(400).json({
      error: {
        code: data.common.serverError,
        detail: err,
      },
    });
  }
};

module.exports.rateChat = async (req, res) => {
  if (req.myId && req.type === data.types.customer) {
    try {
      const { rating } = req.body;
      if (!rating || /\d/.test(rating)) throw data.chat.ratingMissing;
      const ratingArray = Object.keys(data.rating);
      if (ratingArray.includes(rating)) {
        const rateUpdate = await chatModel.findOneAndUpdate(
          {
            customerId: req.myId,
            status: data.chat.started,
          },
          {
            rating: rating,
          },
          {
            new: true,
          }
        );
        if (rateUpdate && rateUpdate.status === data.chat.started) {
          res.status(200).json({
            success: true,
            message: data.chat.ratingAdded,
          });
        } else throw data.chat.ratingFailed;
      } else throw data.chat.ratingMissing;
    } catch (err) {
      res.status(400).json({
        error: {
          code: data.common.serverError,
          detail: err,
        },
      });
    }
  } else {
    res.status(400).json({
      error: {
        code: data.common.serverError,
        detail: data.authErrors.invalidType,
      },
    });
  }
};

module.exports.getMyChat = async (req, res) => {
  try {
    const { chatId } = req.body;
    const findChat = await chatModel
      .find({
        _id: chatId,
        customerId: req.myId,
      })
      .select('customerName agentName status rating');

    if (findChat && findChat.length > 0) {
      const detail = {
        customerName: findChat[0].customerName,
        agentName: findChat[0].agentName,
        status: findChat[0].status,
        rating: findChat[0].rating,
      };
      res.status(200).json({
        success: true,
        message: data.chat.foundChats,
        detail: detail,
      });
    } else {
      throw data.chatAlerts.noChats;
    }
  } catch (err) {
    res.status(400).json({
      error: {
        code: data.common.serverError,
        detail: err,
      },
    });
  }
};

module.exports.endChat = async (req, res, next) => {
  /** end chat by either customer (customerEnded) or agent (with resolution) */
  try {
    let chatDetails = {};
    let actionBy = 'customer';
    const { chatId, resolution } = req.body;
    if (req.type === data.types.agent) {
      if (!resolution || resolution === '') throw data.chat.resolutionMissing;
      else {
        actionBy = 'agent';
        chatDetails = {
          status: data.chat.ended,
          resolution,
          endTime: new Date(),
        };
      }
    } else {
      chatDetails = {
        status: data.chat.customerEnded,
        chatEndedBy: data.types.customer,
      };
    }
    chatModel.findByIdAndUpdate(
      chatId,
      chatDetails,
      {
        new: true,
      },
      (err, chatEnded) => {
        if (err) throw err;
        if (chatEnded) {
          /** send custId for deletion */
          req.body = {
            custId: chatEnded.customerId,
            endedBy: actionBy,
          };
          next();
        }
      }
    );
  } catch (err) {
    res.status(400).json({
      error: {
        code: data.common.serverError,
        detail: err,
      },
    });
  }
};

module.exports.listChat = async (req, res, next) => {
  try {
    const { status } = req.body;
    const agentId = req.type === data.types.admin ? req.body.agentId : req.myId;
    const findChats = await chatModel.find({
      agentId: agentId,
      status: status,
    });
    if (findChats && findChats.length > 0) {
      if (req.type === data.types.admin && status === data.chat.ended) {
        req.body = {
          agentId: agentId,
          status: status,
          totalChatCount: findChats.length,
          chatList: findChats,
        };
        next();
      } else {
        res.status(200).json({
          success: true,
          message: data.chat.foundChats,
          totalChatCount: findChats.length,
          detail: findChats,
        });
      }
    } else throw data.chat.notFound;
  } catch (err) {
    res.status(400).json({
      error: {
        code: data.common.serverError,
        detail: err,
      },
    });
  }
};

module.exports.inactiveChat = async (req, res) => {
  try {
    let updateList = [];
    if (req.custList && req.custList.length > 0) {
      req.custList.forEach(async (cust) => {
        const inactiveSince =
          cust.inactiveSince.getUTCDate().toString().padStart(2, '0') +
          ':' +
          cust.inactiveSince.getUTCHours().toString().padStart(2, '0') +
          ':' +
          cust.inactiveSince.getUTCMinutes().toString().padStart(2, '0') +
          ':' +
          cust.inactiveSince.getUTCSeconds().toString().padStart(2, '0');
        const inactiveData = {
          agentId: data.common.notFound,
          agentName: data.common.notFound,
          customerId: cust._id,
          customerName: cust.userName,
          status: data.chat.timeout,
          resolution: 'inactive for ' + inactiveSince,
          rating: 0,
          startTime: new Date(),
          endTime: 0,
          chatEndedBy: data.chat.systemEnded,
        };
        chatModel.create(inactiveData, (err, chatLog) => {
          if (err) throw err;
          updateList.push(chatLog._id);
        });
      });
      if (updateList || updateList.length > 0) {
        res.status(200).json({
          success: true,
          message: data.chat.deleted,
          detail: updateList,
          info: req.deleted,
        });
      }
    } else {
      res.status(200).json({
        success: true,
        message: data.authSuccess.custDeleted,
        info: req.deleted,
      });
    }
  } catch (err) {
    res.status(400).json({
      error: {
        code: data.common.serverError,
        detail: err,
      },
    });
  }
};

module.exports.deleteChat = async (req, res, next) => {
  try {
    const { chatId } = req.body;
    chatModel.findById(chatId, (errC, chatData) => {
      if (errC) throw errC;
      chatModel.deleteOne({ _id: chatId }, (err, deleteData) => {
        if (err) throw err;
        req.body.customerId = chatData.customerId;
        req.body.chatsDeleted = deleteData.deleteCount;
        next();
      });
    });
  } catch (err) {
    res.status(400).json({
      error: {
        code: data.common.serverError,
        detail: err,
        info: req.body,
      },
    });
  }
};
